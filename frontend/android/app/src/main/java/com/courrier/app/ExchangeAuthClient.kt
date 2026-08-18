package com.courrier.app

import okhttp3.Call
import okhttp3.Callback
import okhttp3.Dns
import okhttp3.FormBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.dnsoverhttps.DnsOverHttps
import org.json.JSONObject
import java.io.IOException
import java.net.InetAddress
import java.net.UnknownHostException

/** Uses Android's DNS/network stack for the Microsoft login host. */
object ExchangeAuthClient {
    private const val CLIENT_ID = "d3590ed6-52b3-4102-aeff-aad2292ab01c"
    private const val SCOPE = "https://outlook.office.com/EWS.AccessAsUser.All offline_access"
    private const val DEVICE_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/devicecode"
    private const val TOKEN_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
    private val doh = DnsOverHttps.Builder()
        .client(OkHttpClient())
        .url("https://dns.google/dns-query".toHttpUrl())
        .bootstrapDnsHosts(
            InetAddress.getByAddress("dns.google", byteArrayOf(8, 8, 8, 8)),
            InetAddress.getByAddress("dns.google", byteArrayOf(8, 8, 4, 4)),
        )
        .build()
    private val resilientDns = object : Dns {
        override fun lookup(hostname: String): List<InetAddress> {
            return try {
                Dns.SYSTEM.lookup(hostname)
            } catch (_: UnknownHostException) {
                doh.lookup(hostname)
            }
        }
    }
    private val client = OkHttpClient.Builder().dns(resilientDns).build()

    fun execute(command: String, args: JSONObject, complete: (Result<JSONObject>) -> Unit) {
        val form = FormBody.Builder().add("client_id", CLIENT_ID)
        val endpoint = when (command) {
            "exchange_auth_device" -> {
                form.add("scope", SCOPE)
                DEVICE_ENDPOINT
            }
            "exchange_auth_token" -> {
                form.add("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
                    .add("device_code", args.optString("deviceCode"))
                TOKEN_ENDPOINT
            }
            "exchange_auth_refresh" -> {
                form.add("grant_type", "refresh_token")
                    .add("refresh_token", args.optString("refreshToken"))
                    .add("scope", SCOPE)
                TOKEN_ENDPOINT
            }
            else -> return complete(Result.failure(IllegalArgumentException("Unsupported Exchange auth command")))
        }
        val request = Request.Builder().url(endpoint).post(form.build()).build()
        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, error: IOException) = complete(Result.failure(error))
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    try {
                        val value = JSONObject(it.body?.string().orEmpty())
                        val error = value.optString("error")
                        if (error.isNotBlank()) {
                            val detail = if (error == "authorization_pending" || error == "slow_down") error
                                else value.optString("error_description").ifBlank { error }
                            complete(Result.failure(IllegalStateException(detail)))
                        } else if (!it.isSuccessful) {
                            complete(Result.failure(IllegalStateException("Microsoft OAuth HTTP ${it.code}")))
                        } else complete(Result.success(value))
                    } catch (error: Exception) {
                        complete(Result.failure(error))
                    }
                }
            }
        })
    }
}
