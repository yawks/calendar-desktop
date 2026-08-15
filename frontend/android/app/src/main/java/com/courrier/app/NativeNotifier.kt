package com.courrier.app
import android.app.*
import android.content.*
import android.os.Build
import androidx.core.app.*
class NativeNotifier(private val c:Context){
 private val m=NotificationManagerCompat.from(c);private val p=c.getSharedPreferences("native_sync_preferences",0)
 init{if(Build.VERSION.SDK_INT>=26)(c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(NotificationChannel(CHANNEL,"Nouveaux emails",NotificationManager.IMPORTANCE_DEFAULT))}
 fun notify(a:SyncAccount,ms:List<NewMessage>){val group="courrier.account."+a.id;ms.forEach{x->val i=Intent(c,MainActivity::class.java).setData(android.net.Uri.parse("courrier://mail/account/"+android.net.Uri.encode(a.id)+"/conversation/"+android.net.Uri.encode(x.conversationId)));val pi=PendingIntent.getActivity(c,x.id.hashCode(),i,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE);val privacy=if(p.getBoolean("vaultLocked",true))p.getString("privacy","generic")else"sender-subject";val text=when(privacy){"sender"->x.sender;"sender-subject"->x.sender+" — "+x.subject;else->"Nouvel email"};m.notify(x.id.hashCode(),NotificationCompat.Builder(c,CHANNEL).setSmallIcon(R.drawable.ic_courrier).setContentTitle(a.email).setContentText(text).setStyle(NotificationCompat.BigTextStyle().bigText(text)).setContentIntent(pi).setAutoCancel(true).setGroup(group).build())};m.notify(("summary:"+a.id).hashCode(),NotificationCompat.Builder(c,CHANNEL).setSmallIcon(R.drawable.ic_courrier).setContentTitle(a.email).setContentText(ms.size.toString()+" nouvel email").setGroup(group).setGroupSummary(true).build())}
 fun cancelAccount(id:String){m.cancel(("summary:"+id).hashCode())};fun cancelConversation(id:String){m.cancel(id.hashCode())}
 companion object{const val CHANNEL="courrier_new_mail"}
}
