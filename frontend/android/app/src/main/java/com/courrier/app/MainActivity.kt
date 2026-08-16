package com.courrier.app
import android.os.Bundle
import com.getcapacitor.BridgeActivity
class MainActivity : BridgeActivity() {
 override fun onCreate(savedInstanceState: Bundle?) {
  registerPlugin(CourrierNativePlugin::class.java)
  super.onCreate(savedInstanceState)
  SyncVault(applicationContext).accountIds().forEach { SyncScheduler.enable(applicationContext, it) }
 }
}
