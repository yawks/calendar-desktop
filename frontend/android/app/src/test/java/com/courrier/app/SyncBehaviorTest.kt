package com.courrier.app
import org.junit.Assert.*
import org.json.JSONObject
import org.junit.Test
class SyncBehaviorTest{
 @Test fun workDataIdentifierIsStableAndSecretFree(){val n=SyncScheduler.workName("account-1");assertEquals(n,SyncScheduler.workName("account-1"));assertFalse(n.contains("password"))}
 @Test fun credentialUpdatesAreMergedWithoutDroppingRefreshToken(){val a=SyncAccount("a","gmail","a@b.c",null,JSONObject().put("refreshToken","r"));val updated=a.withCredentialUpdate(JSONObject().put("accessToken","new"));assertEquals("r",updated.credentials.getString("refreshToken"));assertEquals("new",updated.credentials.getString("accessToken"))}
 @Test fun allProvidersUseTheSameAccountContract(){for(provider in listOf("gmail","exchange","imap","jmap"))assertEquals(provider,SyncAccount("a",provider,"a@b.c",null,JSONObject()).provider)}
 @Test fun groupKeysAreSeparatedByAccount(){assertNotEquals(SyncScheduler.workName("a"),SyncScheduler.workName("b"))}
}
