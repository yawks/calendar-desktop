package com.courrier.app
import android.Manifest
import android.os.Build
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject
@CapacitorPlugin(name="CourrierNative",permissions=[Permission(alias="notifications",strings=[Manifest.permission.POST_NOTIFICATIONS])])
class CourrierNativePlugin:Plugin(){
 @PluginMethod fun configureSync(call:PluginCall){val url=call.getString("serverUrl")?:return call.reject("serverUrl required");if(!url.startsWith("https://"))return call.reject("HTTPS required");val id=call.getString("accountId")?:return call.reject("accountId required");SyncVault(context).put(SyncAccount(id,call.getString("provider")?:"",call.getString("email")?:"",call.getString("displayName"),url,JSONObject(call.getObject("credentials")?.toString()?:"{}")));SyncScheduler.enable(context,id);call.resolve()}
 @PluginMethod fun disableSync(call:PluginCall){val id=call.getString("accountId")?:return call.reject("accountId required");SyncScheduler.disable(context,id);call.resolve()}
 @PluginMethod fun setNotificationPrivacy(call:PluginCall){context.getSharedPreferences("native_sync_preferences",0).edit().putString("privacy",call.getString("privacy")?:"generic").apply();call.resolve()}
 @PluginMethod fun setVaultLocked(call:PluginCall){context.getSharedPreferences("native_sync_preferences",0).edit().putBoolean("vaultLocked",call.getBoolean("locked",true)==true).apply();call.resolve()}
 @PluginMethod fun requestNotificationPermission(call:PluginCall){if(Build.VERSION.SDK_INT<33||getPermissionState("notifications")==PermissionState.GRANTED)call.resolve(JSObject().put("granted",true))else requestPermissionForAlias("notifications",call,"permissionResult")}
 @PermissionCallback private fun permissionResult(call:PluginCall){call.resolve(JSObject().put("granted",getPermissionState("notifications")==PermissionState.GRANTED))}
 @PluginMethod fun cancelConversationNotifications(call:PluginCall){NativeNotifier(context).cancelConversation(call.getString("conversationId")?:"");call.resolve()}
 @PluginMethod fun setBadge(call:PluginCall){call.resolve()}
}
