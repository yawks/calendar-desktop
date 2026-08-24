package com.courrier.app
import org.junit.Assert.*
import org.json.JSONObject
import org.junit.Test
class SyncBehaviorTest{
 @Test fun workDataIdentifierIsStableAndSecretFree(){val n=SyncScheduler.workName("account-1");assertEquals(n,SyncScheduler.workName("account-1"));assertFalse(n.contains("password"))}
 @Test fun credentialUpdatesAreMergedWithoutDroppingRefreshToken(){val a=SyncAccount("a","gmail","a@b.c",null,JSONObject().put("refreshToken","r"));val updated=a.withCredentialUpdate(JSONObject().put("accessToken","new"));assertEquals("r",updated.credentials.getString("refreshToken"));assertEquals("new",updated.credentials.getString("accessToken"))}
 @Test fun allProvidersUseTheSameAccountContract(){for(provider in listOf("gmail","exchange","imap","jmap"))assertEquals(provider,SyncAccount("a",provider,"a@b.c",null,JSONObject()).provider)}
 @Test fun groupKeysAreSeparatedByAccount(){assertNotEquals(SyncScheduler.workName("a"),SyncScheduler.workName("b"))}
 @Test fun syncFailuresAreClassifiedWithoutMatchingFrontendMessages(){assertTrue(SyncFailureClassifier.isRetryable("provider_request_failed"));assertFalse(SyncFailureClassifier.isRetryable("reauthorization_required"));assertEquals("provider_request_failed",SyncFailureClassifier.code(IllegalStateException("provider_request_failed")))}
 @Test fun legacyAccountsMigrateToTheCurrentFormat(){val account=SyncAccount.decode("""{"id":"a","provider":"gmail","email":"a@b.c","credentials":{}}""");assertEquals(1,account.formatVersion);assertEquals("periodic",account.syncMode);assertEquals(0,account.credentialRevision)}
 @Test fun nativeCredentialRefreshAdvancesRevisionAndPreservesSecrets(){val account=SyncAccount("a","gmail","a@b.c",null,JSONObject().put("refreshToken","r"),credentialRevision=4);val updated=account.withCredentialUpdate(JSONObject().put("accessToken","new"));assertEquals(5,updated.credentialRevision);assertEquals("r",updated.credentials.getString("refreshToken"))}
 @Test fun invalidSyncModeFallsBackToPeriodic(){val account=SyncAccount.decode("""{"id":"a","provider":"gmail","email":"a@b.c","syncMode":"surprise","credentials":{}}""");assertEquals("periodic",account.syncMode)}
 @Test fun unsupportedContinuousProviderFallsBackToPeriodic(){val gmail=SyncAccount("a","gmail","a@b.c",null,JSONObject(),syncMode="continuous");val jmap=SyncAccount("b","jmap","b@c.d",null,JSONObject(),syncMode="continuous");val exchange=SyncAccount("c","exchange","c@d.e",null,JSONObject(),syncMode="continuous");assertEquals("periodic",gmail.effectiveSyncMode());assertEquals("continuous",jmap.effectiveSyncMode());assertEquals("continuous",exchange.effectiveSyncMode())}
 @Test fun jmapListenerOnlyAcceptsEmailStateChanges(){assertTrue(ContinuousSyncService.isEmailStateChange("state","""{"changed":{"u1":{"Email":"s2"}}}"""));assertFalse(ContinuousSyncService.isEmailStateChange("ping","{}"));assertFalse(ContinuousSyncService.isEmailStateChange("state","""{"changed":{"u1":{"Mailbox":"s2"}}}"""));assertFalse(ContinuousSyncService.isEmailStateChange("state","not-json"))}
}
