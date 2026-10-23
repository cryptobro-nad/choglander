package com.chog.calls;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Calendar;
import java.util.TimeZone;
import org.junit.Test;

public class AlarmMathTest {
    private static final TimeZone LONDON = TimeZone.getTimeZone("Europe/London");
    private static final TimeZone TOKYO = TimeZone.getTimeZone("Asia/Tokyo");
    private static final int EVERY_DAY = AlarmMath.daysMask(new int[] {0, 1, 2, 3, 4, 5, 6});
    private static final int WEEKDAYS = AlarmMath.daysMask(new int[] {1, 2, 3, 4, 5});

    private static long at(TimeZone zone, int year, int month, int day, int hour, int minute) {
        Calendar c = Calendar.getInstance(zone);
        c.clear();
        c.set(year, month - 1, day, hour, minute, 0);
        return c.getTimeInMillis();
    }

    @Test
    public void daysMaskIgnoresNonsense() {
        assertEquals(0b1000001, AlarmMath.daysMask(new int[] {0, 6, 7, -1}));
        assertEquals(0, AlarmMath.daysMask(null));
    }

    @Test
    public void laterTodayWhenTheTimeIsStillAhead() {
        long now = at(LONDON, 2026, 10, 19, 6, 0); // Monday 06:00
        assertEquals(at(LONDON, 2026, 10, 19, 7, 30), AlarmMath.nextOccurrence(7, 30, EVERY_DAY, now, LONDON));
    }

    @Test
    public void tomorrowRightAfterItRang() {
        long fired = at(LONDON, 2026, 10, 19, 7, 30);
        assertEquals(at(LONDON, 2026, 10, 20, 7, 30), AlarmMath.nextOccurrence(7, 30, EVERY_DAY, fired + 1000, LONDON));
        // Exactly at the alarm time is not "after" it.
        assertEquals(at(LONDON, 2026, 10, 20, 7, 30), AlarmMath.nextOccurrence(7, 30, EVERY_DAY, fired, LONDON));
    }

    @Test
    public void fridayRollsToMondayOnWeekdays() {
        long friday = at(LONDON, 2026, 10, 23, 7, 31);
        assertEquals(at(LONDON, 2026, 10, 26, 7, 30), AlarmMath.nextOccurrence(7, 30, WEEKDAYS, friday, LONDON));
    }

    @Test
    public void staysOnLocalTimeAcrossTheClockChange() {
        // UK clocks go back on Sunday 25 Oct 2026; 07:00 must stay 07:00 local on both sides.
        long saturday = at(LONDON, 2026, 10, 24, 7, 0);
        long sunday = AlarmMath.nextOccurrence(7, 0, EVERY_DAY, saturday + 1000, LONDON);
        assertEquals(at(LONDON, 2026, 10, 25, 7, 0), sunday);
        assertEquals(25 * 60 * 60 * 1000L, sunday - saturday);
        Calendar local = Calendar.getInstance(LONDON);
        local.setTimeInMillis(sunday);
        assertEquals(7, local.get(Calendar.HOUR_OF_DAY));
    }

    @Test
    public void aMissingSpringForwardTimeRollsForwardLikeTheBrowser() {
        // 29 Mar 2026: 01:00 GMT jumps to 02:00 BST, so 01:30 does not exist and becomes 02:30.
        long before = at(LONDON, 2026, 3, 28, 12, 0);
        long next = AlarmMath.nextOccurrence(1, 30, EVERY_DAY, before, LONDON);
        Calendar local = Calendar.getInstance(LONDON);
        local.setTimeInMillis(next);
        assertEquals(29, local.get(Calendar.DAY_OF_MONTH));
        assertEquals(2, local.get(Calendar.HOUR_OF_DAY));
        assertEquals(30, local.get(Calendar.MINUTE));
    }

    @Test
    public void recomputesInTheNewZoneAfterTravel() {
        long now = at(TOKYO, 2026, 10, 19, 22, 0);
        assertEquals(at(TOKYO, 2026, 10, 20, 7, 0), AlarmMath.nextOccurrence(7, 0, EVERY_DAY, now, TOKYO));
    }

    @Test
    public void noDaysOrBadTimeMeansNoAlarm() {
        long now = at(LONDON, 2026, 10, 19, 6, 0);
        assertEquals(-1, AlarmMath.nextOccurrence(7, 0, 0, now, LONDON));
        assertEquals(-1, AlarmMath.nextOccurrence(24, 0, EVERY_DAY, now, LONDON));
        assertEquals(-1, AlarmMath.nextOccurrence(7, 60, EVERY_DAY, now, LONDON));
    }

    @Test
    public void restoreRingsRecentAlarmsAndSkipsOldOnes() {
        long now = at(LONDON, 2026, 10, 19, 7, 5);
        assertEquals(AlarmMath.Restore.SCHEDULE, AlarmMath.restore(now + 60_000, now));
        assertEquals(AlarmMath.Restore.RING_NOW, AlarmMath.restore(now - 5 * 60_000, now));
        assertEquals(AlarmMath.Restore.RING_NOW, AlarmMath.restore(now, now));
        assertEquals(AlarmMath.Restore.STALE, AlarmMath.restore(now - 11 * 60_000, now));
    }

    @Test
    public void clampsSnoozeAndSpeech() {
        assertEquals(9, AlarmMath.snoozeMinutes(null));
        assertEquals(1, AlarmMath.snoozeMinutes(0));
        assertEquals(60, AlarmMath.snoozeMinutes(500));
        assertEquals(5, AlarmMath.snoozeMinutes(5.4));
        assertEquals(1f, AlarmMath.speechScale(null), 0f);
        assertEquals(0.5f, AlarmMath.speechScale(0.1), 0f);
        assertEquals(1.48f, AlarmMath.speechScale(1.48), 1e-6f);
        assertEquals(1f, AlarmMath.speechScale(Double.NaN), 0f);
    }

    @Test
    public void validTimeBounds() {
        assertTrue(AlarmMath.validTime(0, 0));
        assertTrue(AlarmMath.validTime(23, 59));
        assertFalse(AlarmMath.validTime(-1, 0));
    }
}
