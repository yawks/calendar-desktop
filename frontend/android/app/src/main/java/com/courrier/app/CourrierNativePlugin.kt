package com.courrier.app
import android.Manifest
import android.app.Activity
import android.content.Intent
import android.os.Build
import android.util.Base64
import android.util.Log
import androidx.biometric.BiometricPrompt
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject
@CapacitorPlugin(name="CourrierNative",permissions=[Permission(alias="notifications",strings=[Manifest.permission.POST_NOTIFICATIONS])])
class CourrierNativePlugin:Plugin(){
 @PluginMethod fun configureSync(call:PluginCall){val id=call.getString("accountId")?:return call.reject("accountId required");SyncVault(context).put(SyncAccount(id=id,provider=call.getString("provider")?:"",email=call.getString("email")?:"",displayName=call.getString("displayName"),credentials=JSONObject(call.getObject("credentials")?.toString()?:"{}"),syncIntervalMinutes=(call.getInt("syncIntervalMinutes")?:15).coerceIn(5,60)));SyncScheduler.enable(context,id);call.resolve()}
 @PluginMethod fun mailCommand(call:PluginCall){
  try{
   val command=call.getString("command")?:return call.reject("command required");val args=call.getObject("args")?:JSObject()
   if(command.startsWith("exchange_auth_")){
    ExchangeAuthClient.execute(command,JSONObject(args.toString())){result->result.fold(onSuccess={value->call.resolve(JSObject().put("value",value))},onFailure={error->call.reject(error.message?:"Exchange authorization failed",error as? Exception?:Exception(error))})}
    return
   }
   val value=NativeCore.command(command,args.toString());call.resolve(JSObject().put("value",JSONObject("{\"value\":$value}").get("value")))
  }catch(error:Exception){call.reject(error.message,error)}
 }
 @PluginMethod fun exchangeAuth(call:PluginCall){
  val command=call.getString("command")?:return call.reject("command required")
  if(command!="exchange_auth_device"&&command!="exchange_auth_token"&&command!="exchange_auth_refresh")return call.reject("unsupported Exchange auth command")
  val args=call.getObject("args")?:JSObject()
  Log.i("CourrierExchangeAuth","Using Android HTTP client for $command")
  ExchangeAuthClient.execute(command,JSONObject(args.toString())){result->result.fold(onSuccess={value->call.resolve(JSObject().put("value",value))},onFailure={error->call.reject(error.message?:"Exchange authorization failed",error as? Exception?:Exception(error))})}
 }
 @PluginMethod fun openExternalUrl(call:PluginCall){
  val raw=call.getString("url")?:return call.reject("url required")
  try{val uri=android.net.Uri.parse(raw);if(uri.scheme!="http"&&uri.scheme!="https"&&uri.scheme!="mailto")return call.reject("unsupported URL");activity.startActivity(Intent(Intent.ACTION_VIEW,uri));call.resolve()}
  catch(error:Exception){call.reject(error.message,error)}
 }
 @PluginMethod fun googleAuthorize(call:PluginCall){
  val clientId=call.getString("serverClientId")?:return call.reject("serverClientId required")
  val values=call.getArray("capabilities")?.toList<String>().orEmpty()
  val scopes=arrayListOf("openid","email","profile")
  if(values.contains("calendar"))scopes.add("https://www.googleapis.com/auth/calendar")
  if(values.contains("email"))scopes.addAll(listOf("https://mail.google.com/","https://www.googleapis.com/auth/contacts.readonly","https://www.googleapis.com/auth/contacts.other.readonly"))
  val intent=Intent(context,GoogleAuthorizationActivity::class.java).putExtra(GoogleAuthorizationActivity.EXTRA_CLIENT_ID,clientId).putStringArrayListExtra(GoogleAuthorizationActivity.EXTRA_SCOPES,scopes)
  startActivityForResult(call,intent,"googleAuthorizationResult")
 }
 @ActivityCallback private fun googleAuthorizationResult(call:PluginCall?,result:ActivityResult){
  if(call==null)return
  val data=result.data;val code=data?.getStringExtra(GoogleAuthorizationActivity.EXTRA_AUTH_CODE)
  if(result.resultCode!=Activity.RESULT_OK||code.isNullOrBlank())return call.reject(data?.getStringExtra(GoogleAuthorizationActivity.EXTRA_ERROR)?:"Google authorization cancelled")
  call.resolve(JSObject().put("serverAuthCode",code))
 }
 @PluginMethod fun disableSync(call:PluginCall){val id=call.getString("accountId")?:return call.reject("accountId required");SyncScheduler.disable(context,id);call.resolve()}
 @PluginMethod fun setNotificationPrivacy(call:PluginCall){context.getSharedPreferences("native_sync_preferences",0).edit().putString("privacy",call.getString("privacy")?:"generic").apply();call.resolve()}
 @PluginMethod fun setVaultLocked(call:PluginCall){context.getSharedPreferences("native_sync_preferences",0).edit().putBoolean("vaultLocked",call.getBoolean("locked",true)==true).apply();call.resolve()}
 @PluginMethod fun requestNotificationPermission(call:PluginCall){if(Build.VERSION.SDK_INT<33||getPermissionState("notifications")==PermissionState.GRANTED)call.resolve(JSObject().put("granted",true))else requestPermissionForAlias("notifications",call,"permissionResult")}
 @PluginMethod fun notificationPermission(call:PluginCall){val state=if(Build.VERSION.SDK_INT<33)"granted" else when(getPermissionState("notifications")){PermissionState.GRANTED->"granted";PermissionState.DENIED->"denied";else->"default"};call.resolve(JSObject().put("permission",state))}
 @PluginMethod fun setNotificationsEnabled(call:PluginCall){context.getSharedPreferences("native_sync_preferences",0).edit().putBoolean("notificationsEnabled",call.getBoolean("enabled",false)==true).apply();call.resolve()}
 @PermissionCallback private fun permissionResult(call:PluginCall){call.resolve(JSObject().put("granted",getPermissionState("notifications")==PermissionState.GRANTED))}
 @PluginMethod fun cancelConversationNotifications(call:PluginCall){NativeNotifier(context).cancelConversation(call.getString("accountId")?:"",call.getString("conversationId")?:"");call.resolve()}
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
