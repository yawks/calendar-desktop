use jni::{
    errors::ThrowRuntimeExAndDefault,
    objects::{JClass, JString},
    strings::JNIString,
    sys::jstring,
    EnvUnowned,
};
use serde_json::Value;
use std::{ptr, sync::OnceLock};

fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        // Android has no process-level Rust entry point where rustls can install
        // its provider. Do it before the first reqwest client is constructed.
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
        tokio::runtime::Runtime::new().expect("native Tokio runtime")
    })
}

fn java_string(mut env: EnvUnowned<'_>, result: Result<String, String>) -> jstring {
    env.with_env(|env| -> jni::errors::Result<jstring> {
        match result {
            Ok(value) => Ok(env.new_string(value)?.into_raw() as jstring),
            Err(message) => {
                env.throw_new(
                    JNIString::from("java/lang/IllegalStateException"),
                    JNIString::from(message),
                )?;
                Ok(ptr::null_mut())
            }
        }
    })
    .resolve::<ThrowRuntimeExAndDefault>()
}

#[no_mangle]
pub extern "system" fn Java_com_courrier_app_NativeCore_detect(
    mut env: EnvUnowned<'_>,
    _class: JClass<'_>,
    request_json: JString<'_>,
) -> jstring {
    // Formatting JString directly before EnvUnowned::with_env has initialized
    // the JVM singleton produces the literal "<JNI Not Initialized>". Read the
    // Java argument through the current JNI environment instead.
    let input = env
        .with_env(|env| -> jni::errors::Result<String> {
            Ok(request_json.mutf8_chars(env)?.to_string())
        })
        .resolve::<ThrowRuntimeExAndDefault>();
    let result = (|| {
        let request = serde_json::from_str(&input).map_err(|error| error.to_string())?;
        let response = runtime()
            .block_on(crate::sync::detect(request))
            .map_err(|error| error.code.to_string())?;
        serde_json::to_string(&response).map_err(|error| error.to_string())
    })();
    java_string(env, result)
}

#[no_mangle]
pub extern "system" fn Java_com_courrier_app_NativeCore_command(
    mut env: EnvUnowned<'_>,
    _class: JClass<'_>,
    command: JString<'_>,
    arguments_json: JString<'_>,
) -> jstring {
    let command = env
        .with_env(|env| -> jni::errors::Result<String> {
            Ok(command.mutf8_chars(env)?.to_string())
        })
        .resolve::<ThrowRuntimeExAndDefault>();
    let arguments_json = env
        .with_env(|env| -> jni::errors::Result<String> {
            Ok(arguments_json.mutf8_chars(env)?.to_string())
        })
        .resolve::<ThrowRuntimeExAndDefault>();
    let result = (|| {
        let arguments: Value =
            serde_json::from_str(&arguments_json).map_err(|error| error.to_string())?;
        let response = runtime()
            .block_on(crate::command::dispatch(&command, arguments))
            .map_err(|error| error.detail)?;
        serde_json::to_string(&response).map_err(|error| error.to_string())
    })();
    java_string(env, result)
}

#[no_mangle]
pub extern "system" fn Java_com_courrier_app_NativeCore_awaitEvent(
    mut env: EnvUnowned<'_>,
    _class: JClass<'_>,
    request_json: JString<'_>,
) -> jstring {
    let input = env
        .with_env(|env| -> jni::errors::Result<String> {
            Ok(request_json.mutf8_chars(env)?.to_string())
        })
        .resolve::<ThrowRuntimeExAndDefault>();
    let result = (|| {
        let request: crate::sync::SyncRequest =
            serde_json::from_str(&input).map_err(|error| error.to_string())?;
        match request.provider.as_str() {
            "imap" => {
                let config = serde_json::from_value(request.credentials)
                    .map_err(|_| "invalid_imap_credentials".to_string())?;
                runtime().block_on(crate::imap::imap_wait_for_change(config))?;
                Ok("{}".to_string())
            }
            "exchange" => {
                let access_token = request
                    .credentials
                    .get("accessToken")
                    .and_then(Value::as_str)
                    .filter(|token| !token.is_empty())
                    .ok_or_else(|| "invalid_exchange_credentials".to_string())?
                    .to_string();
                let email = request
                    .credentials
                    .get("email")
                    .and_then(Value::as_str)
                    .filter(|email| !email.is_empty())
                    .map(str::to_string);
                runtime().block_on(crate::ews::ews_wait_for_change(access_token, email))?;
                Ok("{}".to_string())
            }
            _ => Err("provider_push_unsupported".to_string()),
        }
    })();
    java_string(env, result)
}
