package com.courrier.app
import android.Manifest
import android.os.Build
import android.util.Base64
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject
@CapacitorPlugin(name="CourrierNative",permissions=[Permission(alias="notifications",strings=[Manifest.permission.POST_NOTIFICATIONS])])
class CourrierNativePlugin:Plugin(){
 @PluginMethod fun configureSync(call:PluginCall){val url=call.getString("serverUrl")?:return call.reject("serverUrl required");if(!url.startsWith("https://"))return call.reject("HTTPS required");val id=call.getString("accountId")?:return call.reject("accountId required");SyncVault(context).put(SyncAccount(id=id,provider=call.getString("provider")?:"",email=call.getString("email")?:"",displayName=call.getString("displayName"),serverUrl=url,credentials=JSONObject(call.getObject("credentials")?.toString()?:"{}"),serverUsername=call.getString("serverUsername"),serverPassword=call.getString("serverPassword")));SyncScheduler.enable(context,id);call.resolve()}
 @PluginMethod fun disableSync(call:PluginCall){val id=call.getString("accountId")?:return call.reject("accountId required");SyncScheduler.disable(context,id);call.resolve()}
 @PluginMethod fun setNotificationPrivacy(call:PluginCall){context.getSharedPreferences("native_sync_preferences",0).edit().putString("privacy",call.getString("privacy")?:"generic").apply();call.resolve()}
 @PluginMethod fun setVaultLocked(call:PluginCall){context.getSharedPreferences("native_sync_preferences",0).edit().putBoolean("vaultLocked",call.getBoolean("locked",true)==true).apply();call.resolve()}
 @PluginMethod fun requestNotificationPermission(call:PluginCall){if(Build.VERSION.SDK_INT<33||getPermissionState("notifications")==PermissionState.GRANTED)call.resolve(JSObject().put("granted",true))else requestPermissionForAlias("notifications",call,"permissionResult")}
 @PluginMethod fun notificationPermission(call:PluginCall){val state=if(Build.VERSION.SDK_INT<33)"granted" else when(getPermissionState("notifications")){PermissionState.GRANTED->"granted";PermissionState.DENIED->"denied";else->"default"};call.resolve(JSObject().put("permission",state))}
 @PluginMethod fun setNotificationsEnabled(call:PluginCall){context.getSharedPreferences("native_sync_preferences",0).edit().putBoolean("notificationsEnabled",call.getBoolean("enabled",false)==true).apply();call.resolve()}
 @PermissionCallback private fun permissionResult(call:PluginCall){call.resolve(JSObject().put("granted",getPermissionState("notifications")==PermissionState.GRANTED))}
 @PluginMethod fun cancelConversationNotifications(call:PluginCall){NativeNotifier(context).cancelConversation(call.getString("conversationId")?:"");call.resolve()}
 @PluginMethod fun setBadge(call:PluginCall){call.resolve()}
 @PluginMethod fun biometricStatus(call:PluginCall){val vault=BiometricVault(context);call.resolve(JSObject().put("available",vault.isAvailable()).put("enabled",vault.isEnabled()))}
 @PluginMethod fun enableBiometricUnlock(call:PluginCall){
  val raw=call.getString("vaultKey")?.let{Base64.decode(it,Base64.NO_WRAP)}?:return call.reject("vaultKey required")
  val vault=BiometricVault(context);if(!vault.isAvailable())return call.reject("Secure biometrics are unavailable")
  authenticate(call,vault.encryptionCipher(),context.getString(R.string.biometric_enable_title)){cipher->vault.store(cipher,raw);call.resolve()}
 }
 @PluginMethod fun unlockWithBiometrics(call:PluginCall){
  val vault=BiometricVault(context);if(!vault.isEnabled())return call.reject("Biometric unlock is not configured")
  try{authenticate(call,vault.decryptionCipher(),context.getString(R.string.biometric_unlock_title)){cipher->call.resolve(JSObject().put("vaultKey",Base64.encodeToString(vault.unlock(cipher),Base64.NO_WRAP)))}}catch(error:Exception){call.reject(error.message,error)}
 }
 @PluginMethod fun disableBiometricUnlock(call:PluginCall){BiometricVault(context).disable();call.resolve()}
 private fun authenticate(call:PluginCall,cipher:javax.crypto.Cipher,title:String,onSuccess:(javax.crypto.Cipher)->Unit){
  val executor=ContextCompat.getMainExecutor(context)
  val prompt=BiometricPrompt(activity as androidx.fragment.app.FragmentActivity,executor,object:BiometricPrompt.AuthenticationCallback(){
   override fun onAuthenticationSucceeded(result:BiometricPrompt.AuthenticationResult){val authenticatedCipher=result.cryptoObject?.cipher?:return call.reject("Biometric cipher unavailable");try{onSuccess(authenticatedCipher)}catch(error:Exception){call.reject(error.message,error)}}
   override fun onAuthenticationError(code:Int,message:CharSequence){call.reject(message.toString())}
  })
  val info=BiometricPrompt.PromptInfo.Builder().setTitle(title).setSubtitle(context.getString(R.string.app_name)).setAllowedAuthenticators(BiometricVault.AUTHENTICATORS).setNegativeButtonText(context.getString(R.string.cancel)).build()
  activity.runOnUiThread{prompt.authenticate(info,BiometricPrompt.CryptoObject(cipher))}
 }
}
