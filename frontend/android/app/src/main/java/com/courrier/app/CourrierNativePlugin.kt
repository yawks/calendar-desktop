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
import androidx.lifecycle.Lifecycle
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject
@CapacitorPlugin(name="CourrierNative",permissions=[Permission(alias="notifications",strings=[Manifest.permission.POST_NOTIFICATIONS])])
class CourrierNativePlugin:Plugin(){
 private var pendingNotificationUrl:String?=null
 override fun handleOnNewIntent(intent:Intent){super.handleOnNewIntent(intent);intent.dataString?.takeIf{it.startsWith("courrier://mail/")}?.let{pendingNotificationUrl=it;Log.i("CourrierDeepLink","Notification intent retained (warm launch)")}}
 @PluginMethod fun consumeNotificationUrl(call:PluginCall){val url=pendingNotificationUrl?:activity.intent?.dataString?.takeIf{it.startsWith("courrier://mail/")};pendingNotificationUrl=null;activity.intent?.data=null;Log.i("CourrierDeepLink","Notification intent consumed present=${url!=null}");call.resolve(JSObject().put("url",url))}
 @PluginMethod fun notificationThread(call:PluginCall){val accountId=call.getString("accountId")?:return call.reject("accountId required");val conversationId=call.getString("conversationId")?:return call.reject("conversationId required");val value=NativeNotifier(context).threadMetadata(accountId,conversationId);call.resolve(JSObject().put("thread",value?.let{JSObject(it.toString())}))}
 @PluginMethod fun configureSync(call:PluginCall){val id=call.getString("accountId")?:return call.reject("accountId required");val provider=call.getString("provider")?:"";val requestedMode=call.getString("syncMode")?.takeIf(SyncAccount.SYNC_MODES::contains)?:"periodic";val mode=if(requestedMode=="continuous"&&!SyncAccount.supportsContinuous(provider))"periodic" else requestedMode;SyncVault(context).putFromPrimary(SyncAccount(id=id,provider=provider,email=call.getString("email")?:"",displayName=call.getString("displayName"),credentials=JSONObject(call.getObject("credentials")?.toString()?:"{}"),syncIntervalMinutes=(call.getInt("syncIntervalMinutes")?:15).coerceIn(15,60),credentialRevision=call.getLong("credentialRevision")?:0,updatedAt=call.getLong("credentialsUpdatedAt")?:System.currentTimeMillis(),syncMode=mode));when(mode){"periodic"->{SyncScheduler.enable(context,id);SyncScheduler.runNow(context,id)};"continuous"->{SyncScheduler.enable(context,id,60);SyncScheduler.runNow(context,id)};else->SyncScheduler.cancelWork(context,id)};ContinuousSyncService.reconcile(context);call.resolve()}
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
 @PluginMethod fun backgroundRestrictions(call:PluginCall){val power=context.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager;call.resolve(JSObject().put("batteryOptimized",!power.isIgnoringBatteryOptimizations(context.packageName)).put("manufacturer",android.os.Build.MANUFACTURER))}
 @PluginMethod fun openBatterySettings(call:PluginCall){try{activity.startActivity(Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));call.resolve()}catch(error:Exception){activity.startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,android.net.Uri.parse("package:${context.packageName}")));call.resolve()}}
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
 @PluginMethod fun disableSync(call:PluginCall){val id=call.getString("accountId")?:return call.reject("accountId required");SyncScheduler.disable(context,id);ContinuousSyncService.reconcile(context);call.resolve()}
 @PluginMethod fun runSyncNow(call:PluginCall){val id=call.getString("accountId")?:return call.reject("accountId required");if(SyncVault(context).get(id)==null)return call.reject("sync is not configured");SyncScheduler.runNow(context,id);call.resolve()}
 @PluginMethod fun getSyncStatus(call:PluginCall){val id=call.getString("accountId")?:return call.reject("accountId required");val account=SyncVault(context).get(id);val value=JSObject(SyncStatusStore(context).get(id).toString()).put("configuredMode",account?.syncMode);val success=value.optLong("lastSuccessAt",0);val staleAfter=(account?.syncIntervalMinutes?:15).coerceAtLeast(15)*180_000L;value.put("watchdogStale",success>0&&System.currentTimeMillis()-success>staleAfter);call.resolve(value)}
 @PluginMethod fun setNotificationPrivacy(call:PluginCall){context.getSharedPreferences("native_sync_preferences",0).edit().putString("privacy",call.getString("privacy")?:"generic").apply();call.resolve()}
 @PluginMethod fun setVaultLocked(call:PluginCall){context.getSharedPreferences("native_sync_preferences",0).edit().putBoolean("vaultLocked",call.getBoolean("locked",true)==true).apply();call.resolve()}
 @PluginMethod fun credentialUpdates(call:PluginCall){if(context.getSharedPreferences("native_sync_preferences",0).getBoolean("vaultLocked",true))return call.reject("vault_locked");val updates=JSArray();val vault=SyncVault(context);vault.accountIds().forEach{id->vault.get(id)?.takeIf{it.credentialRevision>0}?.let{updates.put(JSObject().put("accountId",id).put("credentialRevision",it.credentialRevision).put("credentialsUpdatedAt",it.updatedAt).put("credentials",JSObject(it.credentials.toString())))}};call.resolve(JSObject().put("updates",updates))}
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
  activity.runOnUiThread{
   val host=activity as? androidx.fragment.app.FragmentActivity
   if(host==null||host.isFinishing||host.isDestroyed||!host.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)||host.supportFragmentManager.isStateSaved){
    Log.w("CourrierBiometric","Authentication deferred: activity is not resumed")
    call.reject("Biometric authentication is not ready")
    return@runOnUiThread
   }
   try{prompt.authenticate(info,BiometricPrompt.CryptoObject(cipher))}catch(error:Exception){call.reject(error.message?:"Unable to start biometric authentication",error)}
  }
 }
}
