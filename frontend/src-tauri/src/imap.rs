use std::sync::Arc;
use futures::StreamExt;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use mailparse::{parse_mail, MailAddr, MailHeaderMap, ParsedMail};
use serde::{Deserialize, Serialize};
use tauri::command;
use tokio_rustls::rustls::{ClientConfig, RootCertStore};
use rustls_pki_types::ServerName;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

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

#[derive(Serialize, Debug, Clone)]
pub struct ImapFolder {
    pub folder_id: String,
    pub display_name: String,
    pub total_count: u32,
    pub unread_count: u32,
}

#[derive(Serialize, Debug, Clone)]
pub struct ImapThread {
    pub conversation_id: String,
    pub topic: String,
    pub snippet: String,
    pub last_delivery_time: String,
    pub message_count: u32,
    pub unread_count: u32,
    pub from_name: Option<String>,
    pub has_attachments: bool,
}

#[derive(Serialize, Debug, Clone)]
pub struct ImapMessage {
    pub item_id: String,
    pub change_key: String,
    pub subject: String,
    pub from_name: Option<String>,
    pub from_email: Option<String>,
    pub to_recipients: Vec<ImapRecipient>,
    pub cc_recipients: Vec<ImapRecipient>,
    pub body_html: String,
    pub date_time_received: String,
    pub is_read: bool,
    pub has_attachments: bool,
    pub attachments: Vec<ImapAttachment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_text: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct ImapRecipient {
    pub name: Option<String>,
    pub email: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct ImapAttachment {
    pub attachment_id: String,
    pub name: String,
    pub content_type: String,
    pub size: u64,
    pub is_inline: bool,
}

#[derive(Deserialize, Debug)]
pub struct ComposerAttachment {
    pub name: String,
    pub content_type: String,
    pub data: String, // base64
}

// ── Threading helpers ─────────────────────────────────────────────────────────

/// Metadata collected during the listing fetch, used to build thread groups.
struct MsgMeta {
    uid: u32,
    message_id: Option<String>,
    in_reply_to: Option<String>,
    subject: String,           // original, decoded
    normalized_subject: String, // lowercase, stripped of Re:/Fwd:
    date: String,
    unread: bool,
    from_name: Option<String>,
    header_bytes: Vec<u8>,
    text_bytes: Vec<u8>,
}

fn normalize_message_id(id: &str) -> String {
    id.trim().trim_start_matches('<').trim_end_matches('>').to_lowercase()
}

fn normalize_subject(subject: &str) -> String {
    let prefixes = ["re:", "fwd:", "fw:", "réponse:", "rép:", "tr:", "aw:", "wg:", "sv:", "ref:", "rif:"];
    let mut s = subject.trim().to_lowercase();
    loop {
        let prev_len = s.len();
        for &prefix in &prefixes {
            while s.starts_with(prefix) {
                s = s[prefix.len()..].trim().to_string();
            }
        }
        if s.len() == prev_len { break; }
    }
    s
}

/// Simple union-find: each uid starts as its own root; union merges two groups.
fn uf_find(parent: &mut std::collections::HashMap<u32, u32>, uid: u32) -> u32 {
    if parent[&uid] == uid { return uid; }
    let root = uf_find(parent, parent[&uid]);
    parent.insert(uid, root);
    root
}

fn uf_union(parent: &mut std::collections::HashMap<u32, u32>, a: u32, b: u32) {
    let ra = uf_find(parent, a);
    let rb = uf_find(parent, b);
    if ra != rb {
        // merge larger-uid group into smaller (smaller uid = older message = natural root)
        if ra < rb { parent.insert(rb, ra); } else { parent.insert(ra, rb); }
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
        let tls_stream = tls_connector.connect(server_name, stream)
            .await
            .map_err(|e| format!("IMAP SSL connection error: {}", e))?;
        async_imap::Client::new(tls_stream)
    } else {
        let mut client = async_imap::Client::new(stream);
        let _greeting = client.read_response().await
            .ok_or("No IMAP greeting received")?
            .map_err(|e| format!("IMAP greeting error: {}", e))?;

        if config.imap_use_starttls {
            client.run_command_and_check_ok("STARTTLS", None)
                .await
                .map_err(|e| format!("IMAP STARTTLS command error: {}", e))?;
            let stream = client.into_inner();
            let tls_stream = tls_connector.connect(server_name, stream)
                .await
                .map_err(|e| format!("IMAP STARTTLS handshake error: {}", e))?;
            async_imap::Client::new(tls_stream)
        } else {
            return Err("Plain IMAP without SSL/STARTTLS is not supported for now".to_string());
        }
    };

    let session = client.login(&config.imap_username, &config.imap_password)
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

fn parse_recipient(s: &str) -> ImapRecipient {
    if let Ok(addr) = mailparse::addrparse(s) {
        if let Some(first) = addr.iter().next() {
            match first {
                MailAddr::Single(info) => {
                    return ImapRecipient {
                        name: info.display_name.as_ref().map(|n| decode_maybe_encoded(n)),
                        email: info.addr.clone(),
                    };
                }
                MailAddr::Group(group) => {
                    if let Some(m) = group.addrs.first() {
                        return ImapRecipient {
                            name: m.display_name.as_ref().map(|n| decode_maybe_encoded(n)),
                            email: m.addr.clone(),
                        };
                    }
                }
            }
        }
    }
    ImapRecipient { name: None, email: s.to_string() }
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

fn extract_body(mail: &ParsedMail) -> String {
    if let Some(html) = find_text_part(mail, "text/html") {
        return html;
    }
    if let Some(plain) = find_text_part(mail, "text/plain") {
        return format!("<pre style=\"white-space:pre-wrap;font-family:inherit\">{}</pre>", plain);
    }
    String::new()
}

fn collect_attachments(mail: &ParsedMail, attachments: &mut Vec<ImapAttachment>, index: &mut u32, message_id: &str) {
    let disposition = mail.get_headers().get_first_value("Content-Disposition").unwrap_or_default();
    if disposition.starts_with("attachment") || disposition.starts_with("inline") {
        let name = mail.ctype.params.get("name")
            .cloned()
            .or_else(|| {
                mail.get_headers().get_first_value("Content-ID")
                    .map(|id| id.trim_matches(|c| c == '<' || c == '>').to_string())
            })
            .unwrap_or_else(|| format!("attachment-{}", index));

        attachments.push(ImapAttachment {
            attachment_id: format!("{}:{}", message_id, index),
            name,
            content_type: mail.ctype.mimetype.clone(),
            size: mail.get_body_raw().unwrap_or_default().len() as u64,
            is_inline: disposition.starts_with("inline"),
        });
        *index += 1;
    }
    for sub in &mail.subparts {
        collect_attachments(sub, attachments, index, message_id);
    }
}

/// Remove content inside <style> and <script> blocks, then strip all HTML tags.
fn strip_html(html: &str) -> String {
    // Pass 1: drop <style>…</style> and <script>…</script> blocks (case-insensitive).
    let lower = html.to_lowercase();
    let mut no_blocks = String::with_capacity(html.len());
    let mut pos = 0;
    loop {
        let style  = lower[pos..].find("<style") .map(|p| (pos + p, "</style>"));
        let script = lower[pos..].find("<script").map(|p| (pos + p, "</script>"));
        let next = match (style, script) {
            (None, None) => { no_blocks.push_str(&html[pos..]); break; }
            (Some(a), None) => a,
            (None, Some(b)) => b,
            (Some(a), Some(b)) => if a.0 <= b.0 { a } else { b },
        };
        let (start, end_tag) = next;
        no_blocks.push_str(&html[pos..start]);
        pos = lower[start..].find(end_tag)
            .map(|rel| start + rel + end_tag.len())
            .unwrap_or(html.len()); // no closing tag → truncate
    }
    // Pass 2: strip remaining HTML tags.
    let mut buf = String::with_capacity(no_blocks.len());
    let mut in_tag = false;
    for c in no_blocks.chars() {
        if c == '<' { in_tag = true; }
        else if c == '>' { in_tag = false; }
        else if !in_tag { buf.push(c); }
    }
    buf
}

fn looks_like_base64(s: &str) -> bool {
    s.len() > 40 && s.chars().all(|c| matches!(c, 'A'..='Z' | 'a'..='z' | '0'..='9' | '+' | '/' | '='))
}

/// Extract a plain-text snippet (≤200 chars) from the first bytes of a raw RFC822 message.
/// Uses mailparse for proper MIME parsing and Content-Transfer-Encoding decoding (QP, base64).
fn extract_snippet(raw: &[u8]) -> String {
    // Try mailparse first — it handles QP / base64 decoding correctly
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
    // Fallback for truncated / malformed messages: skip RFC822 headers, then extract body text
    let text = String::from_utf8_lossy(raw);
    let mut result = String::new();
    let mut past_headers = false;
    let mut in_mime_header = false;
    for line in text.lines() {
        if !past_headers {
            if line.trim().is_empty() { past_headers = true; }
            continue;
        }
        let t = line.trim();
        if t.starts_with("--") { in_mime_header = true; continue; }
        if in_mime_header { if t.is_empty() { in_mime_header = false; } continue; }
        if t.is_empty() || looks_like_base64(t) { continue; }
        let stripped = strip_html(t);
        let stripped = stripped.trim();
        if stripped.is_empty() { continue; }
        if !result.is_empty() { result.push(' '); }
        result.push_str(stripped);
        if result.chars().count() >= 200 { break; }
    }
    result.chars().take(200).collect()
}

// ── Commands ───────────────────────────────────────────────────────────────────

#[command]
pub async fn imap_list_folders(config: ImapConfig) -> Result<Vec<ImapFolder>, String> {
    let mut session = get_imap_session(&config).await?;
    let names_stream = session.list(Some(""), Some("*"))
        .await
        .map_err(|e| format!("IMAP list error: {}", e))?;
    let names: Vec<_> = names_stream.collect().await;

    let mut folders = Vec::new();
    for name_result in names {
        let name = name_result.map_err(|e| format!("IMAP list item error: {}", e))?;
        if name.attributes().contains(&async_imap::types::NameAttribute::NoSelect) {
            continue;
        }
        let folder_name = name.name().to_string();
        folders.push(ImapFolder {
            folder_id: folder_name.clone(),
            display_name: folder_name,
            total_count: 0,
            unread_count: 0,
        });
    }

    Ok(folders)
}

#[command]
pub async fn imap_get_inbox_unread(config: ImapConfig, folder: String) -> Result<u32, String> {
    let mut session = get_imap_session(&config).await?;
    let status = session.status(&folder, "(UNSEEN)")
        .await
        .map_err(|e| format!("IMAP status error: {}", e))?;
    Ok(status.unseen.unwrap_or(0))
}

#[command]
pub async fn imap_list_threads(config: ImapConfig, folder: String, max_count: Option<u32>) -> Result<Vec<ImapThread>, String> {
    use std::collections::HashMap;

    let mut session = get_imap_session(&config).await?;
    session.examine(&folder).await.map_err(|e| format!("IMAP examine error: {}", e))?;

    let count = max_count.unwrap_or(50);

    // Over-fetch to compensate for threading: fetching 3× messages gives enough material to
    // build `count` threads even when some threads have several messages.
    let search_results = session.search("ALL").await.map_err(|e| format!("IMAP search error: {}", e))?;
    let mut ids: Vec<u32> = search_results.into_iter().collect();
    ids.sort_by(|a, b| b.cmp(a)); // descending (most recent first)

    let fetch_limit = ((count * 3) as usize).min(ids.len());
    if fetch_limit == 0 { return Ok(vec![]); }

    let query = ids[..fetch_limit].iter().map(|id| id.to_string()).collect::<Vec<_>>().join(",");

    let fetches_stream = session.fetch(query, "(FLAGS INTERNALDATE RFC822.SIZE ENVELOPE RFC822.HEADER BODY.PEEK[TEXT]<0.4096>)")
        .await
        .map_err(|e| format!("IMAP fetch error: {}", e))?;
    let fetches: Vec<_> = fetches_stream.collect().await;

    // ── Collect metadata ──────────────────────────────────────────────────────
    let mut metas: Vec<MsgMeta> = Vec::with_capacity(fetches.len());
    for fetch_result in fetches {
        let fetch = fetch_result.map_err(|e| format!("Fetch item error: {}", e))?;
        let uid: u32 = fetch.message;
        let envelope = match fetch.envelope() { Some(e) => e, None => continue };

        let subject = envelope.subject.as_ref()
            .map(|s| decode_maybe_encoded(&String::from_utf8_lossy(s)))
            .unwrap_or_default();
        let normalized_subject = normalize_subject(&subject);

        let message_id = envelope.message_id.as_ref()
            .map(|b| normalize_message_id(&String::from_utf8_lossy(b)));
        let in_reply_to = envelope.in_reply_to.as_ref()
            .map(|b| normalize_message_id(&String::from_utf8_lossy(b)));

        let date = fetch.internal_date().map(|d| d.to_rfc3339()).unwrap_or_default();
        let unread = !fetch.flags().any(|f| f == async_imap::types::Flag::Seen);
        let from_name = envelope.from.as_ref().and_then(|f| f.first()).and_then(|a| {
            a.name.as_ref().map(|n| decode_maybe_encoded(&String::from_utf8_lossy(n)))
                .or_else(|| a.mailbox.as_ref().map(|m| String::from_utf8_lossy(m).to_string()))
        });

        metas.push(MsgMeta {
            uid,
            message_id,
            in_reply_to,
            subject,
            normalized_subject,
            date,
            unread,
            from_name,
            header_bytes: fetch.header().map(|b| b.to_vec()).unwrap_or_default(),
            text_bytes:   fetch.text().map(|b| b.to_vec()).unwrap_or_default(),
        });
    }

    // ── Build thread groups via union-find ────────────────────────────────────
    // Pass 1: link by Message-ID / In-Reply-To
    let mut parent: HashMap<u32, u32> = metas.iter().map(|m| (m.uid, m.uid)).collect();
    let mid_map: HashMap<String, u32> = metas.iter()
        .filter_map(|m| m.message_id.as_ref().map(|id| (id.clone(), m.uid)))
        .collect();

    for msg in &metas {
        if let Some(ref irt) = msg.in_reply_to {
            if let Some(&parent_uid) = mid_map.get(irt.as_str()) {
                uf_union(&mut parent, parent_uid, msg.uid);
            }
        }
    }

    // Pass 2: group remaining singletons with same normalised subject
    let mut subj_root: HashMap<String, u32> = HashMap::new();
    for msg in &metas {
        if msg.normalized_subject.is_empty() { continue; }
        let root = uf_find(&mut parent, msg.uid);
        match subj_root.get(&msg.normalized_subject) {
            Some(&existing_root) => uf_union(&mut parent, existing_root, root),
            None => { subj_root.insert(msg.normalized_subject.clone(), root); }
        }
    }

    // ── Aggregate groups into ImapThread ─────────────────────────────────────
    let mut groups: HashMap<u32, Vec<&MsgMeta>> = HashMap::new();
    for msg in &metas {
        let root = uf_find(&mut parent, msg.uid);
        groups.entry(root).or_default().push(msg);
    }

    let mut threads: Vec<ImapThread> = groups.into_values().map(|mut msgs| {
        // Sort messages in the group by date ascending (uid ascending is a good proxy)
        msgs.sort_by_key(|m| m.uid);

        let newest = msgs.last().unwrap();
        let oldest = msgs.first().unwrap();

        // conversation_id = comma-separated UIDs oldest→newest (matches getThread expectations)
        let conversation_id = msgs.iter().map(|m| m.uid.to_string()).collect::<Vec<_>>().join(",");

        let unread_count = msgs.iter().filter(|m| m.unread).count() as u32;
        let message_count = msgs.len() as u32;

        // Snippet: prefer the most recent message
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

        ImapThread {
            conversation_id,
            topic: oldest.subject.clone(),
            snippet,
            last_delivery_time: newest.date.clone(),
            message_count,
            unread_count,
            from_name: newest.from_name.clone(),
            has_attachments: false,
        }
    }).collect();

    // Sort threads by most recent message descending, then take top `count`
    threads.sort_by(|a, b| b.last_delivery_time.cmp(&a.last_delivery_time));
    threads.truncate(count as usize);

    Ok(threads)
}

#[command]
pub async fn imap_get_thread(config: ImapConfig, conversation_id: String, folder: String) -> Result<Vec<ImapMessage>, String> {
    let mut session = get_imap_session(&config).await?;
    session.examine(&folder).await.map_err(|e| format!("IMAP examine error: {}", e))?;

    let fetches_stream = session.fetch(&conversation_id, "(FLAGS INTERNALDATE RFC822)")
        .await
        .map_err(|e| format!("IMAP fetch error: {}", e))?;
    let fetches: Vec<_> = fetches_stream.collect().await;

    let mut messages = Vec::new();
    for fetch_result in fetches {
        let fetch = fetch_result.map_err(|e| format!("Fetch item error: {}", e))?;
        let body = fetch.body().ok_or("No body")?;
        let mail = parse_mail(body).map_err(|e| format!("Mail parse error: {}", e))?;

        let subject = mail.headers.get_first_value("Subject")
            .map(|s| decode_maybe_encoded(&s))
            .unwrap_or_default();
        let from = mail.headers.get_first_value("From").unwrap_or_default();
        let from_rec = parse_recipient(&from);

        let mut to_recipients = Vec::new();
        if let Some(to) = mail.headers.get_first_value("To") {
            if let Ok(addr) = mailparse::addrparse(&to) {
                for a in addr.iter() {
                    match a {
                        MailAddr::Single(info) => to_recipients.push(ImapRecipient {
                            name: info.display_name.clone(),
                            email: info.addr.clone(),
                        }),
                        MailAddr::Group(group) => {
                            for m in &group.addrs {
                                to_recipients.push(ImapRecipient {
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
                        MailAddr::Single(info) => cc_recipients.push(ImapRecipient {
                            name: info.display_name.clone(),
                            email: info.addr.clone(),
                        }),
                        MailAddr::Group(group) => {
                            for m in &group.addrs {
                                cc_recipients.push(ImapRecipient {
                                    name: m.display_name.clone(),
                                    email: m.addr.clone(),
                                });
                            }
                        }
                    }
                }
            }
        }

        let body_html = extract_body(&mail);
        let body_text = find_text_part(&mail, "text/plain");
        let date = fetch.internal_date().map(|d| d.to_rfc3339()).unwrap_or_default();
        let is_read = fetch.flags().any(|f| f == async_imap::types::Flag::Seen);

        let mut attachments = Vec::new();
        let mut att_idx = 0;
        let item_id = fetch.message.to_string();
        collect_attachments(&mail, &mut attachments, &mut att_idx, &item_id);

        messages.push(ImapMessage {
            item_id,
            change_key: String::new(),
            subject,
            from_name: from_rec.name,
            from_email: Some(from_rec.email),
            to_recipients,
            cc_recipients,
            body_html,
            date_time_received: date,
            is_read,
            has_attachments: !attachments.is_empty(),
            attachments,
            body_text,
        });
    }

    Ok(messages)
}

#[command]
pub async fn imap_mark_read(config: ImapConfig, folder: String, ids: Vec<String>) -> Result<(), String> {
    let mut session = get_imap_session(&config).await?;
    session.select(&folder).await.map_err(|e| format!("IMAP select error: {}", e))?;
    let query = ids.join(",");
    session.store(query, "+FLAGS (\\Seen)").await.map_err(|e| format!("IMAP store error: {}", e))?
        .collect::<Vec<_>>().await;
    Ok(())
}

#[command]
pub async fn imap_mark_unread(config: ImapConfig, folder: String, ids: Vec<String>) -> Result<(), String> {
    let mut session = get_imap_session(&config).await?;
    session.select(&folder).await.map_err(|e| format!("IMAP select error: {}", e))?;
    let query = ids.join(",");
    session.store(query, "-FLAGS (\\Seen)").await.map_err(|e| format!("IMAP store error: {}", e))?
        .collect::<Vec<_>>().await;
    Ok(())
}

#[command]
pub async fn imap_move_to_trash(config: ImapConfig, folder: String, id: String) -> Result<(), String> {
    let mut session = get_imap_session(&config).await?;
    session.select(&folder).await.map_err(|e| format!("IMAP select error: {}", e))?;

    let folders_stream = session.list(None, Some("*")).await.map_err(|e| format!("IMAP list error: {}", e))?;
    let folders: Vec<_> = folders_stream.collect().await;
    let trash = folders.iter()
        .filter_map(|f| f.as_ref().ok())
        .find(|f| f.name().to_lowercase().contains("trash") || f.name().to_lowercase().contains("corbeille"))
        .map(|f| f.name().to_string())
        .unwrap_or_else(|| "Trash".to_string());

    session.copy(&id, &trash).await.map_err(|e| format!("IMAP copy error: {}", e))?;
    session.store(&id, "+FLAGS (\\Deleted)").await.map_err(|e| format!("IMAP store error: {}", e))?
        .collect::<Vec<_>>().await;
    session.expunge().await.map_err(|e| format!("IMAP expunge error: {}", e))?
        .collect::<Vec<_>>().await;
    Ok(())
}

#[command]
pub async fn imap_permanently_delete(config: ImapConfig, folder: String, id: String) -> Result<(), String> {
    let mut session = get_imap_session(&config).await?;
    session.select(&folder).await.map_err(|e| format!("IMAP select error: {}", e))?;
    session.store(&id, "+FLAGS (\\Deleted)").await.map_err(|e| format!("IMAP store error: {}", e))?
        .collect::<Vec<_>>().await;
    session.expunge().await.map_err(|e| format!("IMAP expunge error: {}", e))?
        .collect::<Vec<_>>().await;
    Ok(())
}

/// Move multiple messages to trash in a single IMAP session (UID set).
#[command]
pub async fn imap_bulk_move_to_trash(config: ImapConfig, folder: String, ids: Vec<String>) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    let mut session = get_imap_session(&config).await?;
    session.select(&folder).await.map_err(|e| format!("IMAP select error: {}", e))?;

    let folders_stream = session.list(None, Some("*")).await.map_err(|e| format!("IMAP list error: {}", e))?;
    let folders: Vec<_> = folders_stream.collect().await;
    let trash = folders.iter()
        .filter_map(|f| f.as_ref().ok())
        .find(|f| {
            let name = f.name().to_lowercase();
            name.contains("trash") || name.contains("corbeille")
        })
        .map(|f| f.name().to_string())
        .unwrap_or_else(|| "Trash".to_string());

    let uid_set = ids.join(",");
    session.copy(&uid_set, &trash).await.map_err(|e| format!("IMAP copy error: {}", e))?;
    session.store(&uid_set, "+FLAGS (\\Deleted)").await.map_err(|e| format!("IMAP store error: {}", e))?
        .collect::<Vec<_>>().await;
    session.expunge().await.map_err(|e| format!("IMAP expunge error: {}", e))?
        .collect::<Vec<_>>().await;
    Ok(())
}

/// Permanently delete multiple messages in a single IMAP session (UID set).
#[command]
pub async fn imap_bulk_permanently_delete(config: ImapConfig, folder: String, ids: Vec<String>) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    let mut session = get_imap_session(&config).await?;
    session.select(&folder).await.map_err(|e| format!("IMAP select error: {}", e))?;
    let uid_set = ids.join(",");
    session.store(&uid_set, "+FLAGS (\\Deleted)").await.map_err(|e| format!("IMAP store error: {}", e))?
        .collect::<Vec<_>>().await;
    session.expunge().await.map_err(|e| format!("IMAP expunge error: {}", e))?
        .collect::<Vec<_>>().await;
    Ok(())
}

#[command]
pub async fn imap_send(
    config: ImapConfig,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    body_html: String,
    attachments: Option<Vec<ComposerAttachment>>,
) -> Result<(), String> {
    let mut email_builder = Message::builder()
        .from(config.email.parse().map_err(|e| format!("Invalid from address: {}", e))?)
        .subject(subject);

    for addr in to {
        email_builder = email_builder.to(addr.parse().map_err(|e| format!("Invalid to address: {}", e))?);
    }
    for addr in cc {
        email_builder = email_builder.cc(addr.parse().map_err(|e| format!("Invalid cc address: {}", e))?);
    }
    for addr in bcc {
        email_builder = email_builder.bcc(addr.parse().map_err(|e| format!("Invalid bcc address: {}", e))?);
    }

    let atts = attachments.unwrap_or_default();
    let email = if atts.is_empty() {
        email_builder
            .header(lettre::message::header::ContentType::TEXT_HTML)
            .body(body_html)
            .map_err(|e| format!("Email build error: {}", e))?
    } else {
        use lettre::message::{MultiPart, SinglePart, header::ContentType};
        let mut multipart = MultiPart::mixed()
            .singlepart(
                SinglePart::builder()
                    .header(ContentType::TEXT_HTML)
                    .body(body_html)
            );

        for att in atts {
            let data = BASE64.decode(att.data).map_err(|e| format!("Base64 decode error: {}", e))?;
            let ct: ContentType = att.content_type.parse().map_err(|e| format!("Invalid content type: {}", e))?;
            multipart = multipart.singlepart(
                SinglePart::builder()
                    .header(ct)
                    .header(lettre::message::header::ContentDisposition::attachment(&att.name))
                    .body(data)
            );
        }
        email_builder.multipart(multipart).map_err(|e| format!("Email build error: {}", e))?
    };

    let creds = Credentials::new(config.smtp_username.clone(), config.smtp_password.clone());

    let mailer = if config.smtp_use_ssl {
        AsyncSmtpTransport::<Tokio1Executor>::relay(&config.smtp_server)
            .map_err(|e| format!("SMTP relay error: {}", e))?
            .port(config.smtp_port)
            .credentials(creds)
            .build()
    } else if config.smtp_use_starttls {
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.smtp_server)
            .map_err(|e| format!("SMTP relay error: {}", e))?
            .port(config.smtp_port)
            .credentials(creds)
            .build()
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&config.smtp_server)
            .port(config.smtp_port)
            .credentials(creds)
            .build()
    };

    mailer.send(email).await.map_err(|e| format!("SMTP send error: {}", e))?;

    Ok(())
}

#[command]
pub async fn imap_get_attachment_data(config: ImapConfig, folder: String, message_id: String, attachment_id: String) -> Result<String, String> {
    let mut session = get_imap_session(&config).await?;
    session.examine(&folder).await.map_err(|e| format!("IMAP examine error: {}", e))?;

    let fetches_stream = session.fetch(&message_id, "RFC822")
        .await
        .map_err(|e| format!("IMAP fetch error: {}", e))?;
    let fetches: Vec<_> = fetches_stream.collect().await;

    let fetch = fetches.into_iter().next()
        .ok_or("Message not found")?
        .map_err(|e| format!("Fetch error: {}", e))?;
    let body = fetch.body().ok_or("No body")?;
    let mail = parse_mail(body).map_err(|e| format!("Mail parse error: {}", e))?;

    let mut current_idx = 0;
    fn find_attachment_data(mail: &ParsedMail, target_idx: u32, current_idx: &mut u32) -> Option<Vec<u8>> {
        let disposition = mail.get_headers().get_first_value("Content-Disposition").unwrap_or_default();
        if disposition.starts_with("attachment") || disposition.starts_with("inline") {
            if *current_idx == target_idx {
                return mail.get_body_raw().ok();
            }
            *current_idx += 1;
        }
        for sub in &mail.subparts {
            if let Some(data) = find_attachment_data(sub, target_idx, current_idx) {
                return Some(data);
            }
        }
        None
    }

    let target_idx = attachment_id.parse::<u32>().map_err(|_| "Invalid attachment ID")?;
    let data = find_attachment_data(&mail, target_idx, &mut current_idx).ok_or("Attachment not found")?;

    Ok(BASE64.encode(data))
}
