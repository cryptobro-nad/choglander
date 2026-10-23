package com.chog.calls;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class NativeEventsTest {
    @Test
    public void unknownKindsAreAlarms() {
        assertEquals("alarm", NativeEvents.kind(null));
        assertEquals("alarm", NativeEvents.kind("whatever"));
        assertEquals("snooze", NativeEvents.kind("snooze"));
        assertEquals("test", NativeEvents.kind("test"));
    }

    @Test
    public void noncesAreUniqueAndCarryTheKind() {
        String a = NativeEvents.newNonce("snooze");
        String b = NativeEvents.newNonce("snooze");
        assertTrue(a.startsWith("snooze-"));
        assertNotEquals(a, b);
        assertTrue(a.matches("[a-z]+-[0-9a-z]+-[0-9a-f]+"));
    }

    @Test
    public void aSnoozedTestCallsBackAsATest() {
        // SnoozeReceiver and ChogAlarm.snooze arm the snooze with the test flag; AlarmReceiver rings
        // it as snoozeKind(test). A test comes back as a test ("test-" id, {kind: "test"}), so the
        // page never logs it as a real wake; a real snooze still rings as "snooze".
        assertEquals("test", NativeEvents.snoozeKind(true));
        assertEquals("snooze", NativeEvents.snoozeKind(false));
        assertTrue(NativeEvents.newNonce(NativeEvents.snoozeKind(true)).startsWith("test-"));
        assertTrue(NativeEvents.script(NativeEvents.snoozeKind(true), "test-a-1").contains("\"kind\":\"test\""));
        assertTrue(NativeEvents.isTest("test"));
        assertFalse(NativeEvents.isTest("snooze"));
        assertFalse(NativeEvents.isTest("alarm"));
        assertFalse(NativeEvents.isTest(null));
    }

    @Test
    public void anEndedRingSaysWhetherItWasATestByItsId() {
        // When the page never saw the ring (the phone was in use), only {kind: "ended", nonce, why}
        // reaches it, and native.ts isTestNonce reads the kind back off the id's prefix.
        assertTrue(NativeEvents.newNonce("test").startsWith("test-"));
        assertTrue(NativeEvents.newNonce("alarm").startsWith("alarm-"));
        assertTrue(NativeEvents.newNonce(null).startsWith("alarm-"));
    }

    @Test
    public void scriptCarriesExactlyOneEvent() {
        String script = NativeEvents.script("test", "test-abc-1");
        assertTrue(script.contains("var E={\"kind\":\"test\",\"nonce\":\"test-abc-1\"};"));
        assertFalse(script.contains("__EVENT__"));
        assertEquals(1, script.split("dispatchEvent", -1).length - 1);
        assertEquals(1, script.split("\\.push\\(E\\)", -1).length - 1);
    }

    @Test
    public void endedIsNeverARingKind() {
        // AlarmReceiver and RingService normalise ring kinds with kind(); "ended" must not ring.
        assertEquals("alarm", NativeEvents.kind("ended"));
    }

    @Test
    public void answerIsItsOwnDeliveryWithTheRingsNonce() {
        String script = NativeEvents.script("alarm", "alarm-x-1", true);
        assertTrue(script.contains("var E={\"kind\":\"alarm\",\"nonce\":\"alarm-x-1\",\"answered\":true};"));
        assertFalse(NativeEvents.script("alarm", "alarm-x-1").contains("answered"));
        assertNotEquals(NativeEvents.key("alarm-x-1", false), NativeEvents.key("alarm-x-1", true));
        assertEquals("alarm-x-1", NativeEvents.key("alarm-x-1", false));
    }

    @Test
    public void endedCarriesWhyAndItsOwnKey() {
        String script = NativeEvents.endedScript("snooze-y-2", "snoozed");
        assertTrue(script.contains("var E={\"kind\":\"ended\",\"nonce\":\"snooze-y-2\",\"why\":\"snoozed\"};"));
        assertTrue(NativeEvents.endedScript("n", "declined").contains("\"why\":\"declined\""));
        assertTrue(NativeEvents.endedScript("n", "timeout").contains("\"why\":\"timeout\""));
        assertTrue(NativeEvents.endedScript("n", "bogus").contains("\"why\":\"timeout\""));
        assertTrue(NativeEvents.endedScript("n", null).contains("\"why\":\"timeout\""));
        assertNotEquals(NativeEvents.endedKey("n"), NativeEvents.key("n", false));
        assertNotEquals(NativeEvents.endedKey("n"), NativeEvents.key("n", true));
    }

    @Test
    public void quoteEscapesAnythingThatCouldBreakOut() {
        assertEquals("\"a\\\"b\\\\c\\u003c/script\\u003e\"", NativeEvents.quote("a\"b\\c</script>"));
    }

    @Test
    public void templateHasNoDoubleQuotesOrBackslashes() {
        // native.test.ts reads DELIVERY_SCRIPT verbatim out of NativeEvents.java.
        assertFalse(NativeEvents.DELIVERY_SCRIPT.contains("\""));
        assertFalse(NativeEvents.DELIVERY_SCRIPT.contains("\\"));
    }
}
