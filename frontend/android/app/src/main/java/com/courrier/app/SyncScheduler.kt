package com.courrier.app
import android.content.Context
import androidx.work.*
import java.util.concurrent.TimeUnit
object SyncScheduler {
 internal fun workName(id:String)="courrier-sync-"+id.hashCode()
 fun enable(c:Context,id:String){val r=PeriodicWorkRequestBuilder<MailSyncWorker>(15,TimeUnit.MINUTES).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).setInputData(workDataOf("accountId" to id)).build();WorkManager.getInstance(c).enqueueUniquePeriodicWork(workName(id),ExistingPeriodicWorkPolicy.UPDATE,r)}
 fun disable(c:Context,id:String){WorkManager.getInstance(c).cancelUniqueWork(workName(id));SyncVault(c).delete(id);c.getSharedPreferences("native_sync_state",0).edit().remove(id).remove("seen:"+id).apply();NativeNotifier(c).cancelAccount(id)}
}
