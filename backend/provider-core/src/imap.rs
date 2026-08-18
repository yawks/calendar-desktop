use crate::mail_provider::*;
use async_imap::imap_proto::types::{BodyContentCommon, BodyStructure, SectionPath};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures::StreamExt;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use mailparse::{parse_mail, MailAddr, MailHeaderMap, ParsedMail};
use rustls_pki_types::ServerName;
use serde::Deserialize;
use std::sync::Arc;
use tokio_rustls::rustls::{ClientConfig, RootCertStore};

#[derive(Deserialize, Debug, Clone)]
pub struct ImapConfig {
    pub email: String,
    pub imap_server: String,
    pub imap_port: u16,
    pub imap_use_ssl: bool,
    pub imap_use_starttls: bool,
    pub imap_username: String,
    pub imap_password: String,
    pub smtp_server: String,
    pub smtp_port: u16,
    pub smtp_use_ssl: bool,
    pub smtp_use_starttls: bool,
    pub smtp_username: String,
    pub smtp_password: String,
}

pub struct ImapProvider {
    config: ImapConfig,
    folder: Option<String>,
    load_bodies: bool,
}

impl ImapProvider {
    pub fn new(config: ImapConfig) -> Self {
        Self {
            config,
            folder: None,
            load_bodies: false,
        }
    }
    pub fn with_folder(config: ImapConfig, folder: String) -> Self {
        Self {
            config,
            folder: Some(folder),
            load_bodies: false,
        }
    }
    pub fn with_folder_and_bodies(config: ImapConfig, folder: String) -> Self {
        Self {
            config,
            folder: Some(folder),
            load_bodies: true,
        }
    }
}

// ── Threading helpers ─────────────────────────────────────────────────────────

struct MsgMeta {
    uid: u32,
    message_id: Option<String>,
    in_reply_to: Option<String>,
    subject: String,
    normalized_subject: String,
    date: String,
    unread: bool,
    from_name: Option<String>,
    from_email: Option<String>,
    to_recipients: Vec<MailRecipient>,
    cc_recipients: Vec<MailRecipient>,
    header_bytes: Vec<u8>,
    text_bytes: Vec<u8>,
}

fn normalize_message_id(id: &str) -> String {
    id.trim()
        .trim_start_matches('<')
        .trim_end_matches('>')
        .to_lowercase()
}

fn normalize_subject(subject: &str) -> String {
    let prefixes = [
        "re:",
        "fwd:",
        "fw:",
        "réponse:",
        "rép:",
        "tr:",
        "aw:",
        "wg:",
        "sv:",
        "ref:",
        "rif:",
    ];
    let mut s = subject.trim().to_lowercase();
    loop {
        let prev_len = s.len();
        for &prefix in &prefixes {
            while s.starts_with(prefix) {
                s = s[prefix.len()..].trim().to_string();
            }
        }
        if s.len() == prev_len {
            break;
        }
    }
    s
}

fn uf_find(parent: &mut std::collections::HashMap<u32, u32>, uid: u32) -> u32 {
    if parent[&uid] == uid {
        return uid;
    }
    let root = uf_find(parent, parent[&uid]);
    parent.insert(uid, root);
    root
}

fn uf_union(parent: &mut std::collections::HashMap<u32, u32>, a: u32, b: u32) {
    let ra = uf_find(parent, a);
    let rb = uf_find(parent, b);
    if ra != rb {
        if ra < rb {
            parent.insert(rb, ra);
        } else {
            parent.insert(ra, rb);
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type ImapStream = tokio_rustls::client::TlsStream<tokio::net::TcpStream>;

async fn get_imap_session(config: &ImapConfig) -> Result<async_imap::Session<ImapStream>, String> {
    let mut root_store = RootCertStore::empty();
    root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let tls_config = ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();
    let tls_connector = tokio_rustls::TlsConnector::from(Arc::new(tls_config));

    let domain = config.imap_server.clone();
    let port = config.imap_port;
    let server_name = ServerName::try_from(domain.as_str())
        .map_err(|_| format!("Invalid server name: {}", domain))?
        .to_owned();

    let stream = tokio::net::TcpStream::connect((domain.as_str(), port))
        .await
        .map_err(|e| format!("TCP connection error: {}", e))?;

    let client = if config.imap_use_ssl {
        let tls_stream = tls_connector
            .connect(server_name, stream)
            .await
            .map_err(|e| format!("IMAP SSL connection error: {}", e))?;
        async_imap::Client::new(tls_stream)
    } else {
        let mut client = async_imap::Client::new(stream);
        let _greeting = client
            .read_response()
            .await
            .ok_or("No IMAP greeting received")?
            .map_err(|e| format!("IMAP greeting error: {}", e))?;

        if config.imap_use_starttls {
            client
                .run_command_and_check_ok("STARTTLS", None)
                .await
                .map_err(|e| format!("IMAP STARTTLS command error: {}", e))?;
            let stream = client.into_inner();
            let tls_stream = tls_connector
                .connect(server_name, stream)
                .await
                .map_err(|e| format!("IMAP STARTTLS handshake error: {}", e))?;
            async_imap::Client::new(tls_stream)
        } else {
            return Err("Plain IMAP without SSL/STARTTLS is not supported for now".to_string());
        }
    };

    let session = client
        .login(&config.imap_username, &config.imap_password)
        .await
        .map_err(|(e, _)| format!("IMAP login error: {}", e))?;
    Ok(session)
}

fn decode_maybe_encoded(s: &str) -> String {
    let fake_header = format!("Subject: {}", s);
    if let Ok((header, _)) = mailparse::parse_header(fake_header.as_bytes()) {
        return header.get_value();
    }
    s.to_string()
}

fn parse_addr_header(value: &str) -> Vec<MailRecipient> {
    match mailparse::addrparse(value) {
        Ok(addr_list) => addr_list
            .iter()
            .flat_map(|addr| -> Vec<MailRecipient> {
                match addr {
                    MailAddr::Single(info) => vec![MailRecipient {
                        name: info
                            .display_name
                            .as_ref()
                            .map(|n| decode_maybe_encoded(n))
                            .filter(|n| !n.is_empty()),
                        email: info.addr.clone(),
                    }],
                    MailAddr::Group(g) => g
                        .addrs
                        .iter()
                        .map(|m| MailRecipient {
                            name: m
                                .display_name
                                .as_ref()
                                .map(|n| decode_maybe_encoded(n))
                                .filter(|n| !n.is_empty()),
                            email: m.addr.clone(),
                        })
                        .collect(),
                }
            })
            .collect(),
        Err(_) => vec![],
    }
}

fn parse_recipient(s: &str) -> MailRecipient {
    if let Ok(addr) = mailparse::addrparse(s) {
        if let Some(first) = addr.iter().next() {
            match first {
                MailAddr::Single(info) => {
                    return MailRecipient {
                        name: info.display_name.as_ref().map(|n| decode_maybe_encoded(n)),
                        email: info.addr.clone(),
                    };
                }
                MailAddr::Group(group) => {
                    if let Some(m) = group.addrs.first() {
                        return MailRecipient {
                            name: m.display_name.as_ref().map(|n| decode_maybe_encoded(n)),
                            email: m.addr.clone(),
                        };
                    }
                }
            }
        }
    }
    MailRecipient {
        name: None,
        email: s.to_string(),
    }
}

fn find_text_part(mail: &ParsedMail, mimetype: &str) -> Option<String> {
    if mail.ctype.mimetype == mimetype {
        return mail.get_body().ok();
    }
    for sub in &mail.subparts {
        if let Some(body) = find_text_part(sub, mimetype) {
            return Some(body);
        }
    }
    None
}

// ── BODYSTRUCTURE helpers (lazy attachment loading) ──────────────────────────

fn section_path_str(path: &[u32]) -> String {
    path.iter()
        .map(|n| n.to_string())
        .collect::<Vec<_>>()
        .join(".")
}

fn get_filename_from_bs(common: &BodyContentCommon<'_>, subtype: &str) -> String {
    common
        .ty
        .params
        .as_ref()
        .and_then(|p| p.iter().find(|(k, _)| k.to_lowercase() == "name"))
        .map(|(_, v)| v.to_string())
        .or_else(|| {
            common
                .disposition
                .as_ref()
                .and_then(|d| d.params.as_ref())
                .and_then(|p| p.iter().find(|(k, _)| k.to_lowercase() == "filename"))
                .map(|(_, v)| v.to_string())
        })
        .unwrap_or_else(|| format!("attachment.{}", subtype))
}

fn find_body_section(bs: &BodyStructure, parent_path: &[u32]) -> Option<(Vec<u32>, bool)> {
    match bs {
        BodyStructure::Text { common, .. } => {
            let subtype = common.ty.subtype.to_lowercase();
            let section = if parent_path.is_empty() {
                vec![1]
            } else {
                parent_path.to_vec()
            };
            if subtype == "html" {
                Some((section, true))
            } else if subtype == "plain" {
                Some((section, false))
            } else {
                None
            }
        }
        BodyStructure::Basic { .. } => None,
        BodyStructure::Message { body, .. } => {
            let base = if parent_path.is_empty() {
                vec![1u32]
            } else {
                parent_path.to_vec()
            };
            let child: Vec<u32> = base.iter().chain(&[1u32]).copied().collect();
            find_body_section(body, &child)
        }
        BodyStructure::Multipart { bodies, common, .. } => {
            let subtype = common.ty.subtype.to_lowercase();
            let base: &[u32] = if parent_path.is_empty() {
                &[]
            } else {
                parent_path
            };
            if subtype == "alternative" {
                let mut html_result: Option<(Vec<u32>, bool)> = None;
                let mut plain_result: Option<(Vec<u32>, bool)> = None;
                for (i, body) in bodies.iter().enumerate() {
                    let child: Vec<u32> = base.iter().chain(&[i as u32 + 1]).copied().collect();
                    match find_body_section(body, &child) {
                        Some((sp, true)) if html_result.is_none() => html_result = Some((sp, true)),
                        Some((sp, false)) if plain_result.is_none() => {
                            plain_result = Some((sp, false))
                        }
                        _ => {}
                    }
                }
                html_result.or(plain_result)
            } else {
                for (i, body) in bodies.iter().enumerate() {
                    let child: Vec<u32> = base.iter().chain(&[i as u32 + 1]).copied().collect();
                    if let Some(result) = find_body_section(body, &child) {
                        return Some(result);
                    }
                }
                None
            }
        }
    }
}

fn collect_attachments_from_bs(
    bs: &BodyStructure,
    parent_path: &[u32],
    folder: &str,
    seq_num: &str,
    result: &mut Vec<MailAttachment>,
) {
    let my_section: Vec<u32> = if parent_path.is_empty() {
        vec![1]
    } else {
        parent_path.to_vec()
    };
    match bs {
        BodyStructure::Basic { common, other, .. } => {
            let disp = common.disposition.as_ref().map(|d| d.ty.to_lowercase());
            let disp_str = disp.as_deref().unwrap_or("");
            if disp_str == "attachment" || disp_str == "inline" {
                let ty = common.ty.ty.to_lowercase();
                let subtype = common.ty.subtype.to_lowercase();
                result.push(MailAttachment {
                    attachment_id: format!(
                        "{}:{}:{}",
                        folder,
                        seq_num,
                        section_path_str(&my_section)
                    ),
                    name: get_filename_from_bs(common, &subtype),
                    content_type: format!("{}/{}", ty, subtype),
                    size: other.octets as u64,
                    is_inline: disp_str == "inline",
                });
            }
        }
        BodyStructure::Text { common, other, .. } => {
            if common
                .disposition
                .as_ref()
                .map(|d| d.ty.to_lowercase())
                .as_deref()
                == Some("attachment")
            {
                let ty = common.ty.ty.to_lowercase();
                let subtype = common.ty.subtype.to_lowercase();
                result.push(MailAttachment {
                    attachment_id: format!(
                        "{}:{}:{}",
                        folder,
                        seq_num,
                        section_path_str(&my_section)
                    ),
                    name: get_filename_from_bs(common, &subtype),
                    content_type: format!("{}/{}", ty, subtype),
                    size: other.octets as u64,
                    is_inline: false,
                });
            }
        }
        BodyStructure::Message { body, .. } => {
            let child: Vec<u32> = my_section.iter().chain(&[1u32]).copied().collect();
            collect_attachments_from_bs(body, &child, folder, seq_num, result);
        }
        BodyStructure::Multipart { bodies, .. } => {
            let base: &[u32] = if parent_path.is_empty() {
                &[]
            } else {
                parent_path
            };
            for (i, body) in bodies.iter().enumerate() {
                let child: Vec<u32> = base.iter().chain(&[i as u32 + 1]).copied().collect();
                collect_attachments_from_bs(body, &child, folder, seq_num, result);
            }
        }
    }
}

fn strip_html(html: &str) -> String {
    let lower = html.to_lowercase();
    let mut no_blocks = String::with_capacity(html.len());
    let mut pos = 0;
    loop {
        let style = lower[pos..].find("<style").map(|p| (pos + p, "</style>"));
        let script = lower[pos..].find("<script").map(|p| (pos + p, "</script>"));
        let next = match (style, script) {
            (None, None) => {
                no_blocks.push_str(&html[pos..]);
                break;
            }
            (Some(a), None) => a,
            (None, Some(b)) => b,
            (Some(a), Some(b)) => {
                if a.0 <= b.0 {
                    a
                } else {
                    b
                }
            }
        };
        let (start, end_tag) = next;
        no_blocks.push_str(&html[pos..start]);
        pos = lower[start..]
            .find(end_tag)
            .map(|rel| start + rel + end_tag.len())
            .unwrap_or(html.len());
    }
    let mut buf = String::with_capacity(no_blocks.len());
    let mut in_tag = false;
    for c in no_blocks.chars() {
        if c == '<' {
            in_tag = true;
        } else if c == '>' {
            in_tag = false;
        } else if !in_tag {
            buf.push(c);
        }
    }
    buf
}

fn looks_like_base64(s: &str) -> bool {
    s.len() > 40
        && s.chars()
            .all(|c| matches!(c, 'A'..='Z' | 'a'..='z' | '0'..='9' | '+' | '/' | '='))
}

fn extract_snippet(raw: &[u8]) -> String {
    if let Ok(mail) = parse_mail(raw) {
        if let Some(text) = find_text_part(&mail, "text/plain") {
            if !text.trim().is_empty() {
                let words: Vec<&str> = text.split_whitespace().collect();
                return words.join(" ").chars().take(200).collect();
            }
        }
        if let Some(html) = find_text_part(&mail, "text/html") {
            let stripped = strip_html(&html);
            let words: Vec<&str> = stripped.split_whitespace().collect();
            let joined = words.join(" ");
            if !joined.is_empty() {
                return joined.chars().take(200).collect();
            }
        }
    }
    let text = String::from_utf8_lossy(raw);
    let mut result = String::new();
    let mut past_headers = false;
    let mut in_mime_header = false;
    for line in text.lines() {
        if !past_headers {
            if line.trim().is_empty() {
                past_headers = true;
            }
            continue;
        }
        let t = line.trim();
        if t.starts_with("--") {
            in_mime_header = true;
            continue;
        }
        if in_mime_header {
            if t.is_empty() {
                in_mime_header = false;
            }
            continue;
        }
        if t.is_empty() || looks_like_base64(t) {
            continue;
        }
        let stripped = strip_html(t);
        let stripped = stripped.trim();
        if stripped.is_empty() {
            continue;
        }
        if !result.is_empty() {
            result.push(' ');
        }
        result.push_str(stripped);
        if result.chars().count() >= 200 {
            break;
        }
    }
    result.chars().take(200).collect()
}

// ── MailProvider impl ─────────────────────────────────────────────────────────

impl MailProvider for ImapProvider {
    async fn list_folders(&self) -> Result<Vec<MailFolder>, String> {
        let mut session = get_imap_session(&self.config).await?;
        let names_stream = session
            .list(Some(""), Some("*"))
            .await
            .map_err(|e| format!("IMAP list error: {}", e))?;
        let names: Vec<_> = names_stream.collect().await;

        let mut folders = Vec::new();
        for name_result in names {
            let name = name_result.map_err(|e| format!("IMAP list item error: {}", e))?;
            if name
                .attributes()
                .contains(&async_imap::types::NameAttribute::NoSelect)
            {
                continue;
            }
            let folder_name = name.name().to_string();
            folders.push(MailFolder {
                folder_id: folder_name.clone(),
                display_name: folder_name,
                total_count: 0,
                unread_count: 0,
            });
        }
        Ok(folders)
    }

    async fn get_inbox_unread(&self) -> Result<u32, String> {
        let folder = self
            .folder
            .as_deref()
            .ok_or_else(|| "IMAP folder required".to_string())?;
        let mut session = get_imap_session(&self.config).await?;
        let status = session
            .status(folder, "(UNSEEN)")
            .await
            .map_err(|e| format!("IMAP status error: {}", e))?;
        Ok(status.unseen.unwrap_or(0))
    }

    async fn list_threads(
        &self,
        folder: &str,
        max_count: Option<u32>,
    ) -> Result<Vec<MailThread>, String> {
        use std::collections::HashMap;

        let mut session = get_imap_session(&self.config).await?;
        session
            .examine(folder)
            .await
            .map_err(|e| format!("IMAP examine error: {}", e))?;

        let count = max_count.unwrap_or(50);

        let search_results = session
            .search("ALL")
            .await
            .map_err(|e| format!("IMAP search error: {}", e))?;
        let mut ids: Vec<u32> = search_results.into_iter().collect();
        ids.sort_by(|a, b| b.cmp(a));

        let fetch_limit = ((count * 3) as usize).min(ids.len());
        if fetch_limit == 0 {
            return Ok(vec![]);
        }

        let query = ids[..fetch_limit]
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(",");

        let fetches_stream = session
            .fetch(
                query,
                "(FLAGS INTERNALDATE RFC822.SIZE ENVELOPE RFC822.HEADER)",
            )
            .await
            .map_err(|e| format!("IMAP fetch error: {}", e))?;
        let fetches: Vec<_> = fetches_stream.collect().await;

        let mut metas: Vec<MsgMeta> = Vec::with_capacity(fetches.len());
        for fetch_result in fetches {
            let fetch = fetch_result.map_err(|e| format!("Fetch item error: {}", e))?;
            let uid: u32 = fetch.message;
            let envelope = match fetch.envelope() {
                Some(e) => e,
                None => continue,
            };

            let subject = envelope
                .subject
                .as_ref()
                .map(|s| decode_maybe_encoded(&String::from_utf8_lossy(s)))
                .unwrap_or_default();
            let normalized_subject = normalize_subject(&subject);

            let message_id = envelope
                .message_id
                .as_ref()
                .map(|b| normalize_message_id(&String::from_utf8_lossy(b)));
            let in_reply_to = envelope
                .in_reply_to
                .as_ref()
                .map(|b| normalize_message_id(&String::from_utf8_lossy(b)));

            let date = fetch
                .internal_date()
                .map(|d| d.to_rfc3339())
                .unwrap_or_default();
            let unread = !fetch.flags().any(|f| f == async_imap::types::Flag::Seen);
            let from_addr = envelope.from.as_ref().and_then(|f| f.first());
            let from_name = from_addr.and_then(|a| {
                a.name
                    .as_ref()
                    .map(|n| decode_maybe_encoded(&String::from_utf8_lossy(n)))
                    .or_else(|| {
                        a.mailbox
                            .as_ref()
                            .map(|m| String::from_utf8_lossy(m).to_string())
                    })
            });
            let from_email = from_addr.and_then(|a| {
                let mb = a
                    .mailbox
                    .as_ref()
                    .map(|m| String::from_utf8_lossy(m).to_string())?;
                let host = a
                    .host
                    .as_ref()
                    .map(|h| String::from_utf8_lossy(h).to_string())
                    .unwrap_or_default();
                Some(format!("{}@{}", mb, host))
            });

            // Parse To/Cc from raw RFC822 headers — preserves display names (envelope may strip them)
            let (to_recipients, cc_recipients) = if let Some(hdr) = fetch.header() {
                if let Ok((hdrs, _)) = mailparse::parse_headers(hdr) {
                    let to_val = hdrs.get_first_value("To").unwrap_or_default();
                    let cc_val = hdrs.get_first_value("Cc").unwrap_or_default();
                    (parse_addr_header(&to_val), parse_addr_header(&cc_val))
                } else {
                    (vec![], vec![])
                }
            } else {
                (vec![], vec![])
            };

            metas.push(MsgMeta {
                uid,
                message_id,
                in_reply_to,
                subject,
                normalized_subject,
                date,
                unread,
                from_name,
                from_email,
                to_recipients,
                cc_recipients,
                header_bytes: fetch.header().map(|b| b.to_vec()).unwrap_or_default(),
                text_bytes: fetch.text().map(|b| b.to_vec()).unwrap_or_default(),
            });
        }

        let mut parent: HashMap<u32, u32> = metas.iter().map(|m| (m.uid, m.uid)).collect();
        let mid_map: HashMap<String, u32> = metas
            .iter()
            .filter_map(|m| m.message_id.as_ref().map(|id| (id.clone(), m.uid)))
            .collect();

        for msg in &metas {
            if let Some(ref irt) = msg.in_reply_to {
                if let Some(&parent_uid) = mid_map.get(irt.as_str()) {
                    uf_union(&mut parent, parent_uid, msg.uid);
                }
            }
        }

        let mut subj_root: HashMap<String, u32> = HashMap::new();
        for msg in &metas {
            if msg.normalized_subject.is_empty() {
                continue;
            }
            let root = uf_find(&mut parent, msg.uid);
            match subj_root.get(&msg.normalized_subject) {
                Some(&existing_root) => uf_union(&mut parent, existing_root, root),
                None => {
                    subj_root.insert(msg.normalized_subject.clone(), root);
                }
            }
        }

        let mut groups: HashMap<u32, Vec<&MsgMeta>> = HashMap::new();
        for msg in &metas {
            let root = uf_find(&mut parent, msg.uid);
            groups.entry(root).or_default().push(msg);
        }

        let own_email = self.config.email.to_lowercase();
        let mut threads: Vec<MailThread> = groups
            .into_values()
            .map(|mut msgs| {
                msgs.sort_by_key(|m| m.uid);
                let newest = msgs.last().unwrap();
                let oldest = msgs.first().unwrap();
                let conversation_id = msgs
                    .iter()
                    .map(|m| m.uid.to_string())
                    .collect::<Vec<_>>()
                    .join(",");
                let unread_count = msgs.iter().filter(|m| m.unread).count() as u32;
                let message_count = msgs.len() as u32;

                // Unique senders across all messages in the thread, excluding own email
                let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
                let unique_senders: Vec<MailRecipient> = msgs
                    .iter()
                    .filter_map(|m| {
                        let email_str = m.from_email.as_deref().unwrap_or("").to_lowercase();
                        if email_str.is_empty() || email_str == own_email {
                            return None;
                        }
                        if !seen.insert(email_str) {
                            return None;
                        }
                        Some(MailRecipient {
                            name: m.from_name.clone(),
                            email: m.from_email.clone().unwrap_or_default(),
                        })
                    })
                    .collect();

                let snippet = {
                    let h = &newest.header_bytes;
                    let t = &newest.text_bytes;
                    if !h.is_empty() && !t.is_empty() {
                        let mut combined = h.clone();
                        if !combined.ends_with(b"\r\n\r\n") && !combined.ends_with(b"\n\n") {
                            combined.extend_from_slice(b"\r\n");
                        }
                        combined.extend_from_slice(t);
                        extract_snippet(&combined)
                    } else if !t.is_empty() {
                        extract_snippet(t)
                    } else {
                        String::new()
                    }
                };

                MailThread {
                    conversation_id,
                    topic: oldest.subject.clone(),
                    snippet,
                    last_delivery_time: newest.date.clone(),
                    message_count,
                    unread_count,
                    from_name: newest.from_name.clone(),
                    from_email: newest.from_email.clone(),
                    has_attachments: false,
                    to_recipients: newest.to_recipients.clone(),
                    cc_recipients: newest.cc_recipients.clone(),
                    unique_senders,
                    snoozed_until: None,
                }
            })
            .collect();

        threads.sort_by(|a, b| b.last_delivery_time.cmp(&a.last_delivery_time));
        threads.truncate(count as usize);
        Ok(threads)
    }

    async fn get_thread(
        &self,
        conversation_id: &str,
        _include_trash: Option<bool>,
        _is_draft: Option<bool>,
        _include_drafts: Option<bool>,
    ) -> Result<Vec<MailMessage>, String> {
        let folder = self
            .folder
            .as_deref()
            .ok_or_else(|| "IMAP folder required".to_string())?;
        let mut session = get_imap_session(&self.config).await?;
        session
            .examine(folder)
            .await
            .map_err(|e| format!("IMAP examine error: {}", e))?;

        let phase1_stream = session
            .fetch(
                conversation_id,
                "(FLAGS INTERNALDATE BODY.PEEK[HEADER] BODYSTRUCTURE)",
            )
            .await
            .map_err(|e| format!("IMAP fetch error: {}", e))?;
        let phase1: Vec<_> = phase1_stream.collect().await;

        struct Pending {
            seq_num: u32,
            subject: String,
            from_name: Option<String>,
            from_email: Option<String>,
            to_recipients: Vec<MailRecipient>,
            cc_recipients: Vec<MailRecipient>,
            date: String,
            is_read: bool,
            attachments: Vec<MailAttachment>,
            body_section: Vec<u32>,
            body_is_html: bool,
        }

        let mut pending: Vec<Pending> = Vec::new();

        for fetch_result in &phase1 {
            let fetch = fetch_result
                .as_ref()
                .map_err(|e| format!("Fetch item error: {}", e))?;

            let header_bytes = fetch.header().unwrap_or(b"");
            let mut hdr = header_bytes.to_vec();
            if !hdr.ends_with(b"\r\n\r\n") && !hdr.ends_with(b"\n\n") {
                hdr.extend_from_slice(b"\r\n");
            }
            let mail = parse_mail(&hdr).map_err(|e| format!("Header parse error: {}", e))?;

            let subject = mail
                .headers
                .get_first_value("Subject")
                .map(|s| decode_maybe_encoded(&s))
                .unwrap_or_default();
            let from = mail.headers.get_first_value("From").unwrap_or_default();
            let from_rec = parse_recipient(&from);

            let mut to_recipients = Vec::new();
            if let Some(to) = mail.headers.get_first_value("To") {
                if let Ok(addr) = mailparse::addrparse(&to) {
                    for a in addr.iter() {
                        match a {
                            MailAddr::Single(info) => to_recipients.push(MailRecipient {
                                name: info.display_name.clone(),
                                email: info.addr.clone(),
                            }),
                            MailAddr::Group(group) => {
                                for m in &group.addrs {
                                    to_recipients.push(MailRecipient {
                                        name: m.display_name.clone(),
                                        email: m.addr.clone(),
                                    });
                                }
                            }
                        }
                    }
                }
            }

            let mut cc_recipients = Vec::new();
            if let Some(cc) = mail.headers.get_first_value("Cc") {
                if let Ok(addr) = mailparse::addrparse(&cc) {
                    for a in addr.iter() {
                        match a {
                            MailAddr::Single(info) => cc_recipients.push(MailRecipient {
                                name: info.display_name.clone(),
                                email: info.addr.clone(),
                            }),
                            MailAddr::Group(group) => {
                                for m in &group.addrs {
                                    cc_recipients.push(MailRecipient {
                                        name: m.display_name.clone(),
                                        email: m.addr.clone(),
                                    });
                                }
                            }
                        }
                    }
                }
            }

            let date = fetch
                .internal_date()
                .map(|d| d.to_rfc3339())
                .unwrap_or_default();
            let is_read = fetch.flags().any(|f| f == async_imap::types::Flag::Seen);
            let seq_num = fetch.message;

            let (body_section, body_is_html, attachments) = if let Some(bs) = fetch.bodystructure()
            {
                let (section, is_html) = find_body_section(bs, &[]).unwrap_or((vec![1], false));
                let mut atts = Vec::new();
                collect_attachments_from_bs(bs, &[], folder, &seq_num.to_string(), &mut atts);
                (section, is_html, atts)
            } else {
                (vec![1], false, Vec::new())
            };

            pending.push(Pending {
                seq_num,
                subject,
                from_name: from_rec.name,
                from_email: Some(from_rec.email),
                to_recipients,
                cc_recipients,
                date,
                is_read,
                attachments,
                body_section,
                body_is_html,
            });
        }

        let mut messages = Vec::new();
        for p in pending {
            let body_html = if self.load_bodies {
                let section_str = section_path_str(&p.body_section);
                let fetch_cmd = format!("BODY.PEEK[{}]", section_str);
                let body_stream = session
                    .fetch(&p.seq_num.to_string(), &fetch_cmd)
                    .await
                    .map_err(|e| format!("IMAP body fetch error: {}", e))?;
                let body_results: Vec<_> = body_stream.collect().await;
                body_results.into_iter().next().and_then(|r| r.ok()).and_then(|bf| {
                    let sp = SectionPath::Part(p.body_section.clone(), None);
                    bf.section(&sp).map(|data| {
                        let text = String::from_utf8_lossy(data).to_string();
                        if p.body_is_html { text } else {
                            let escaped = text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
                            format!("<pre style=\"white-space:pre-wrap;font-family:inherit\">{}</pre>", escaped)
                        }
                    })
                }).unwrap_or_default()
            } else {
                String::new()
            };
            let body_text = if body_html.is_empty() {
                None
            } else {
                Some(strip_html(&body_html))
            };

            messages.push(MailMessage {
                item_id: p.seq_num.to_string(),
                change_key: String::new(),
                subject: p.subject,
                from_name: p.from_name,
                from_email: p.from_email,
                to_recipients: p.to_recipients,
                cc_recipients: p.cc_recipients,
                body_html,
                date_time_received: p.date,
                is_read: p.is_read,
                has_attachments: !p.attachments.is_empty(),
                attachments: p.attachments,
                body_text,
                ics_mime: None,
                is_draft: None,
                message_id: None,
                references: None,
            });
        }
        Ok(messages)
    }

    async fn mark_read(&self, items: &[MailItemRef]) -> Result<(), String> {
        let folder = items
            .first()
            .and_then(|i| i.folder.as_deref())
            .ok_or_else(|| "IMAP folder required".to_string())?;
        let mut session = get_imap_session(&self.config).await?;
        session
            .select(folder)
            .await
            .map_err(|e| format!("IMAP select error: {}", e))?;
        let query = items
            .iter()
            .map(|i| i.item_id.as_str())
            .collect::<Vec<_>>()
            .join(",");
        session
            .store(query, "+FLAGS (\\Seen)")
            .await
            .map_err(|e| format!("IMAP store error: {}", e))?
            .collect::<Vec<_>>()
            .await;
        Ok(())
    }

    async fn mark_unread(&self, items: &[MailItemRef]) -> Result<(), String> {
        let folder = items
            .first()
            .and_then(|i| i.folder.as_deref())
            .ok_or_else(|| "IMAP folder required".to_string())?;
        let mut session = get_imap_session(&self.config).await?;
        session
            .select(folder)
            .await
            .map_err(|e| format!("IMAP select error: {}", e))?;
        let query = items
            .iter()
            .map(|i| i.item_id.as_str())
            .collect::<Vec<_>>()
            .join(",");
        session
            .store(query, "-FLAGS (\\Seen)")
            .await
            .map_err(|e| format!("IMAP store error: {}", e))?
            .collect::<Vec<_>>()
            .await;
        Ok(())
    }

    async fn move_to_trash(&self, item_id: &str) -> Result<(), String> {
        let folder = self
            .folder
            .as_deref()
            .ok_or_else(|| "IMAP folder required".to_string())?;
        let mut session = get_imap_session(&self.config).await?;
        session
            .select(folder)
            .await
            .map_err(|e| format!("IMAP select error: {}", e))?;

        let folders_stream = session
            .list(None, Some("*"))
            .await
            .map_err(|e| format!("IMAP list error: {}", e))?;
        let folders: Vec<_> = folders_stream.collect().await;
        let trash = folders
            .iter()
            .filter_map(|f| f.as_ref().ok())
            .find(|f| {
                f.name().to_lowercase().contains("trash")
                    || f.name().to_lowercase().contains("corbeille")
            })
            .map(|f| f.name().to_string())
            .unwrap_or_else(|| "Trash".to_string());

        session
            .copy(item_id, &trash)
            .await
            .map_err(|e| format!("IMAP copy error: {}", e))?;
        session
            .store(item_id, "+FLAGS (\\Deleted)")
            .await
            .map_err(|e| format!("IMAP store error: {}", e))?
            .collect::<Vec<_>>()
            .await;
        session
            .expunge()
            .await
            .map_err(|e| format!("IMAP expunge error: {}", e))?
            .collect::<Vec<_>>()
            .await;
        Ok(())
    }

    async fn permanently_delete(&self, item_id: &str) -> Result<(), String> {
        let folder = self
            .folder
            .as_deref()
            .ok_or_else(|| "IMAP folder required".to_string())?;
        let mut session = get_imap_session(&self.config).await?;
        session
            .select(folder)
            .await
            .map_err(|e| format!("IMAP select error: {}", e))?;
        session
            .store(item_id, "+FLAGS (\\Deleted)")
            .await
            .map_err(|e| format!("IMAP store error: {}", e))?
            .collect::<Vec<_>>()
            .await;
        session
            .expunge()
            .await
            .map_err(|e| format!("IMAP expunge error: {}", e))?
            .collect::<Vec<_>>()
            .await;
        Ok(())
    }

    async fn bulk_move_to_trash(&self, item_ids: Vec<String>) -> Result<(), String> {
        if item_ids.is_empty() {
            return Ok(());
        }
        let folder = self
            .folder
            .as_deref()
            .ok_or_else(|| "IMAP folder required".to_string())?;
        let mut session = get_imap_session(&self.config).await?;
        session
            .select(folder)
            .await
            .map_err(|e| format!("IMAP select error: {}", e))?;

        let folders_stream = session
            .list(None, Some("*"))
            .await
            .map_err(|e| format!("IMAP list error: {}", e))?;
        let folders: Vec<_> = folders_stream.collect().await;
        let trash = folders
            .iter()
            .filter_map(|f| f.as_ref().ok())
            .find(|f| {
                let name = f.name().to_lowercase();
                name.contains("trash") || name.contains("corbeille")
            })
            .map(|f| f.name().to_string())
            .unwrap_or_else(|| "Trash".to_string());

        let uid_set = item_ids.join(",");
        session
            .copy(&uid_set, &trash)
            .await
            .map_err(|e| format!("IMAP copy error: {}", e))?;
        session
            .store(&uid_set, "+FLAGS (\\Deleted)")
            .await
            .map_err(|e| format!("IMAP store error: {}", e))?
            .collect::<Vec<_>>()
            .await;
        session
            .expunge()
            .await
            .map_err(|e| format!("IMAP expunge error: {}", e))?
            .collect::<Vec<_>>()
            .await;
        Ok(())
    }

    async fn bulk_permanently_delete(&self, item_ids: Vec<String>) -> Result<(), String> {
        if item_ids.is_empty() {
            return Ok(());
        }
        let folder = self
            .folder
            .as_deref()
            .ok_or_else(|| "IMAP folder required".to_string())?;
        let mut session = get_imap_session(&self.config).await?;
        session
            .select(folder)
            .await
            .map_err(|e| format!("IMAP select error: {}", e))?;
        let uid_set = item_ids.join(",");
        session
            .store(&uid_set, "+FLAGS (\\Deleted)")
            .await
            .map_err(|e| format!("IMAP store error: {}", e))?
            .collect::<Vec<_>>()
            .await;
        session
            .expunge()
            .await
            .map_err(|e| format!("IMAP expunge error: {}", e))?
            .collect::<Vec<_>>()
            .await;
        Ok(())
    }

    async fn send_mail(&self, params: SendMailParams) -> Result<(), String> {
        let mut email_builder = Message::builder()
            .from(
                self.config
                    .email
                    .parse()
                    .map_err(|e| format!("Invalid from address: {}", e))?,
            )
            .subject(params.subject);

        for addr in params.to {
            email_builder = email_builder.to(addr
                .parse()
                .map_err(|e| format!("Invalid to address: {}", e))?);
        }
        for addr in params.cc {
            email_builder = email_builder.cc(addr
                .parse()
                .map_err(|e| format!("Invalid cc address: {}", e))?);
        }
        for addr in params.bcc {
            email_builder = email_builder.bcc(
                addr.parse()
                    .map_err(|e| format!("Invalid bcc address: {}", e))?,
            );
        }

        let atts = params.attachments.unwrap_or_default();
        let email = if atts.is_empty() {
            email_builder
                .header(lettre::message::header::ContentType::TEXT_HTML)
                .body(params.body_html)
                .map_err(|e| format!("Email build error: {}", e))?
        } else {
            use lettre::message::{header::ContentType, MultiPart, SinglePart};
            let mut multipart = MultiPart::mixed().singlepart(
                SinglePart::builder()
                    .header(ContentType::TEXT_HTML)
                    .body(params.body_html),
            );
            for att in atts {
                let data = BASE64
                    .decode(att.data)
                    .map_err(|e| format!("Base64 decode error: {}", e))?;
                let ct: ContentType = att
                    .content_type
                    .parse()
                    .map_err(|e| format!("Invalid content type: {}", e))?;
                multipart = multipart.singlepart(
                    SinglePart::builder()
                        .header(ct)
                        .header(lettre::message::header::ContentDisposition::attachment(
                            &att.name,
                        ))
                        .body(data),
                );
            }
            email_builder
                .multipart(multipart)
                .map_err(|e| format!("Email build error: {}", e))?
        };

        let creds = Credentials::new(
            self.config.smtp_username.clone(),
            self.config.smtp_password.clone(),
        );
        let mailer = if self.config.smtp_use_ssl {
            AsyncSmtpTransport::<Tokio1Executor>::relay(&self.config.smtp_server)
                .map_err(|e| format!("SMTP relay error: {}", e))?
                .port(self.config.smtp_port)
                .credentials(creds)
                .build()
        } else if self.config.smtp_use_starttls {
            AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&self.config.smtp_server)
                .map_err(|e| format!("SMTP relay error: {}", e))?
                .port(self.config.smtp_port)
                .credentials(creds)
                .build()
        } else {
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&self.config.smtp_server)
                .port(self.config.smtp_port)
                .credentials(creds)
                .build()
        };
        mailer
            .send(email)
            .await
            .map_err(|e| format!("SMTP send error: {}", e))?;
        Ok(())
    }

    async fn get_attachment_data(
        &self,
        attachment_id: &str,
        message_id: Option<&str>,
        folder: Option<&str>,
    ) -> Result<String, String> {
        let folder = folder.ok_or_else(|| "IMAP folder required".to_string())?;
        let message_id = message_id.ok_or_else(|| "IMAP message_id required".to_string())?;

        let mut session = get_imap_session(&self.config).await?;
        session
            .examine(folder)
            .await
            .map_err(|e| format!("IMAP examine error: {}", e))?;

        let section_parts: Vec<u32> = attachment_id
            .split('.')
            .map(|s| {
                s.parse::<u32>()
                    .map_err(|_| format!("Invalid section component: {}", s))
            })
            .collect::<Result<Vec<_>, _>>()?;

        let fetch_cmd = format!("BODY.PEEK[{}]", attachment_id);
        let fetches_stream = session
            .fetch(message_id, &fetch_cmd)
            .await
            .map_err(|e| format!("IMAP fetch error: {}", e))?;
        let fetches: Vec<_> = fetches_stream.collect().await;

        let fetch = fetches
            .into_iter()
            .next()
            .ok_or("Message not found")?
            .map_err(|e| format!("Fetch error: {}", e))?;

        let sp = SectionPath::Part(section_parts, None);
        let data = fetch.section(&sp).ok_or("Attachment section not found")?;

        let stripped: Vec<u8> = data
            .iter()
            .filter(|&&b| !b.is_ascii_whitespace())
            .copied()
            .collect();
        match BASE64.decode(&stripped) {
            Ok(decoded) => Ok(BASE64.encode(&decoded)),
            Err(_) => Ok(BASE64.encode(data)),
        }
    }
}

// ── Public provider operations ────────────────────────────────────────────────

pub async fn imap_list_folders(config: ImapConfig) -> Result<Vec<MailFolder>, String> {
    ImapProvider::new(config).list_folders().await
}

pub async fn imap_get_inbox_unread(config: ImapConfig, folder: String) -> Result<u32, String> {
    ImapProvider::with_folder(config, folder)
        .get_inbox_unread()
        .await
}

pub async fn imap_list_threads(
    config: ImapConfig,
    folder: String,
    max_count: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<MailThread>, String> {
    let offset = offset.unwrap_or(0);
    let count = max_count.unwrap_or(50);
    let threads = ImapProvider::new(config)
        .list_threads(&folder, Some(count.saturating_add(offset)))
        .await?;
    Ok(threads
        .into_iter()
        .skip(offset as usize)
        .take(count as usize)
        .collect())
}

pub async fn imap_get_thread(
    config: ImapConfig,
    conversation_id: String,
    folder: String,
) -> Result<Vec<MailMessage>, String> {
    ImapProvider::with_folder(config, folder)
        .get_thread(&conversation_id, None, None, None)
        .await
}

pub async fn imap_get_message_content(
    config: ImapConfig,
    message_id: String,
    folder: String,
) -> Result<MailMessage, String> {
    ImapProvider::with_folder_and_bodies(config, folder)
        .get_thread(&message_id, None, None, None)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| "IMAP message not found".to_string())
}

pub async fn imap_get_thread_snippet(
    config: ImapConfig,
    conversation_id: String,
    folder: String,
) -> Result<String, String> {
    let newest = conversation_id
        .split(',')
        .filter_map(|id| id.parse::<u32>().ok())
        .max()
        .ok_or_else(|| "Invalid IMAP conversation id".to_string())?;
    let mut session = get_imap_session(&config).await?;
    session
        .examine(&folder)
        .await
        .map_err(|e| format!("IMAP examine error: {}", e))?;
    let stream = session
        .fetch(newest.to_string(), "BODY.PEEK[TEXT]<0.4096>")
        .await
        .map_err(|e| format!("IMAP snippet fetch error: {}", e))?;
    let results: Vec<_> = stream.collect().await;
    let text = results
        .into_iter()
        .next()
        .transpose()
        .map_err(|e| format!("IMAP snippet item error: {}", e))?
        .and_then(|fetch| fetch.text().map(|bytes| bytes.to_vec()))
        .unwrap_or_default();
    Ok(extract_snippet(&text))
}

pub async fn imap_mark_read(
    config: ImapConfig,
    folder: String,
    ids: Vec<String>,
) -> Result<(), String> {
    let items: Vec<MailItemRef> = ids
        .into_iter()
        .map(|id| MailItemRef {
            item_id: id,
            change_key: String::new(),
            conversation_id: None,
            folder: Some(folder.clone()),
        })
        .collect();
    ImapProvider::new(config).mark_read(&items).await
}

pub async fn imap_mark_unread(
    config: ImapConfig,
    folder: String,
    ids: Vec<String>,
) -> Result<(), String> {
    let items: Vec<MailItemRef> = ids
        .into_iter()
        .map(|id| MailItemRef {
            item_id: id,
            change_key: String::new(),
            conversation_id: None,
            folder: Some(folder.clone()),
        })
        .collect();
    ImapProvider::new(config).mark_unread(&items).await
}

pub async fn imap_move_to_trash(
    config: ImapConfig,
    folder: String,
    id: String,
) -> Result<(), String> {
    ImapProvider::with_folder(config, folder)
        .move_to_trash(&id)
        .await
}

pub async fn imap_permanently_delete(
    config: ImapConfig,
    folder: String,
    id: String,
) -> Result<(), String> {
    ImapProvider::with_folder(config, folder)
        .permanently_delete(&id)
        .await
}

pub async fn imap_bulk_move_to_trash(
    config: ImapConfig,
    folder: String,
    ids: Vec<String>,
) -> Result<(), String> {
    ImapProvider::with_folder(config, folder)
        .bulk_move_to_trash(ids)
        .await
}

pub async fn imap_bulk_permanently_delete(
    config: ImapConfig,
    folder: String,
    ids: Vec<String>,
) -> Result<(), String> {
    ImapProvider::with_folder(config, folder)
        .bulk_permanently_delete(ids)
        .await
}

pub async fn imap_send(
    config: ImapConfig,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    body_html: String,
    attachments: Option<Vec<ComposerAttachment>>,
) -> Result<(), String> {
    ImapProvider::new(config)
        .send_mail(SendMailParams {
            to,
            cc,
            bcc,
            subject,
            body_html,
            attachments,
            reply_to_item_id: None,
            reply_to_change_key: None,
            is_forward: None,
            identity_id: None,
            in_reply_to: None,
            references: None,
            send_at: None,
        })
        .await
}

pub async fn imap_get_attachment_data(
    config: ImapConfig,
    folder: String,
    message_id: String,
    attachment_id: String,
) -> Result<String, String> {
    ImapProvider::new(config)
        .get_attachment_data(&attachment_id, Some(&message_id), Some(&folder))
        .await
}
