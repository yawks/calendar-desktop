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
 fun put(a:SyncAccount) { val c=Cipher.getInstance("AES/GCM/NoPadding").apply{init(Cipher.ENCRYPT_MODE,key())}; prefs.edit().putString(a.id,Base64.encodeToString(c.iv+c.doFinal(a.encode().toByteArray()),Base64.NO_WRAP)).apply() }
 fun get(id:String):SyncAccount?=prefs.getString(id,null)?.let{val b=Base64.decode(it,Base64.NO_WRAP);val c=Cipher.getInstance("AES/GCM/NoPadding").apply{init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,b.copyOfRange(0,12)))};SyncAccount.decode(String(c.doFinal(b.copyOfRange(12,b.size))))}
 fun delete(id:String){prefs.edit().remove(id).apply()}
 fun accountIds():Set<String> = prefs.all.keys
}
