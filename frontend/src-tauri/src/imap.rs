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

        // Wrap status in a Result to handle cases where a folder might be listable but not statusable
        let (total, unread) = match session.status(&folder_name, "(MESSAGES UNSEEN)").await {
            Ok(status) => (status.exists, status.unseen.unwrap_or(0)),
            Err(_) => (0, 0),
        };

        folders.push(ImapFolder {
            folder_id: folder_name.clone(),
            display_name: folder_name,
            total_count: total,
            unread_count: unread,
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
    let mut session = get_imap_session(&config).await?;
    session.examine(&folder).await.map_err(|e| format!("IMAP examine error: {}", e))?;

    let count = max_count.unwrap_or(50);
    let search_results = session.search("ALL").await.map_err(|e| format!("IMAP search error: {}", e))?;
    let mut ids: Vec<u32> = search_results.into_iter().collect();
    ids.sort_by(|a, b| b.cmp(a));

    let limit = (count as usize).min(ids.len());
    if limit == 0 { return Ok(vec![]); }

    let range = &ids[..limit];
    let query = range.iter().map(|id| id.to_string()).collect::<Vec<_>>().join(",");

    let fetches_stream = session.fetch(query, "(FLAGS INTERNALDATE RFC822.SIZE ENVELOPE BODY.PEEK[1]<0.200>)")
        .await
        .map_err(|e| format!("IMAP fetch error: {}", e))?;
    let fetches: Vec<_> = fetches_stream.collect().await;

    let mut threads = Vec::new();
    for fetch_result in fetches {
        let fetch = fetch_result.map_err(|e| format!("Fetch item error: {}", e))?;
        let uid = fetch.message.to_string();
        let envelope = fetch.envelope().ok_or("No envelope")?;

        let subject = envelope.subject.as_ref()
            .map(|s| decode_maybe_encoded(&String::from_utf8_lossy(s)))
            .unwrap_or_default();
        let date = fetch.internal_date().map(|d| d.to_rfc3339()).unwrap_or_default();
        let unread = !fetch.flags().any(|f| f == async_imap::types::Flag::Seen);

        let from_name = envelope.from.as_ref().and_then(|f| f.first()).and_then(|a| {
            a.name.as_ref().map(|n| decode_maybe_encoded(&String::from_utf8_lossy(n)))
                .or_else(|| a.mailbox.as_ref().map(|m| String::from_utf8_lossy(m).to_string()))
        });

        let snippet = fetch.attrs().iter().find_map(|attr| {
            if let async_imap::types::AttributeValue::BodySection(bs) = attr {
                bs.data
            } else {
                None
            }
        })
        .or_else(|| fetch.text())
        .map(|t| String::from_utf8_lossy(t).trim().replace('\n', " ").replace('\r', ""))
        .unwrap_or_default();

        threads.push(ImapThread {
            conversation_id: uid.clone(),
            topic: subject,
            snippet,
            last_delivery_time: date,
            message_count: 1,
            unread_count: if unread { 1 } else { 0 },
            from_name,
            has_attachments: false,
        });
    }

    // Sort by date descending
    threads.sort_by(|a, b| b.last_delivery_time.cmp(&a.last_delivery_time));

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
