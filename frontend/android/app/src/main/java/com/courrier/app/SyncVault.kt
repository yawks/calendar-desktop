package com.courrier.app
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.*
import javax.crypto.spec.GCMParameterSpec
class SyncVault(context:Context) {
 private val prefs=context.getSharedPreferences("native_sync_vault",Context.MODE_PRIVATE); private val alias="courrier.sync.v1"
 private fun key():SecretKey { val s=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}; (s.getKey(alias,null) as? SecretKey)?.let{return it}; return KeyGenerator.getInstance("AES","AndroidKeyStore").apply{init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes("GCM").setEncryptionPaddings("NoPadding").setUserAuthenticationRequired(false).build())}.generateKey() }
 @Synchronized fun putFromPrimary(incoming:SyncAccount):SyncAccount {
  val current=get(incoming.id)
  val resolved=if(current!=null&&current.credentialRevision>incoming.credentialRevision){
   incoming.copy(credentials=current.credentials,credentialRevision=current.credentialRevision,updatedAt=maxOf(current.updatedAt,incoming.updatedAt))
  }else incoming.copy(formatVersion=SyncAccount.CURRENT_FORMAT_VERSION)
  write(resolved);return resolved
 }
 @Synchronized fun updateCredentials(id:String,update:org.json.JSONObject):SyncAccount? {
  val current=get(id)?:return null
  return current.withCredentialUpdate(update).also(::write)
 }
 @Synchronized fun get(id:String):SyncAccount?=prefs.getString(id,null)?.let{decrypt(it)}?.let{account->
  if(account.formatVersion<SyncAccount.CURRENT_FORMAT_VERSION) account.copy(formatVersion=SyncAccount.CURRENT_FORMAT_VERSION,updatedAt=maxOf(account.updatedAt,System.currentTimeMillis())).also(::write) else account
 }
 @Synchronized fun delete(id:String){prefs.edit().remove(id).commit()}
 fun accountIds():Set<String> = prefs.all.keys
 private fun write(a:SyncAccount){val c=Cipher.getInstance("AES/GCM/NoPadding").apply{init(Cipher.ENCRYPT_MODE,key())};check(prefs.edit().putString(a.id,Base64.encodeToString(c.iv+c.doFinal(a.encode().toByteArray()),Base64.NO_WRAP)).commit()){"sync_vault_write_failed"}}
 private fun decrypt(value:String):SyncAccount {val b=Base64.decode(value,Base64.NO_WRAP);require(b.size>12){"invalid_sync_vault_entry"};val c=Cipher.getInstance("AES/GCM/NoPadding").apply{init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,b.copyOfRange(0,12)))};return SyncAccount.decode(String(c.doFinal(b.copyOfRange(12,b.size))))}
}
