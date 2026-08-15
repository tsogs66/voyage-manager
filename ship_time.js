/**
 * Ship's clock / zone time for noon-report log entries.
 *
 * Date/time on the log is ship's clock (datetime-local, no zone suffix).
 * When the ship changes zone the clocks are advanced or retarded — usually
 * 30 minutes or 1 hour. Period hours must use actual elapsed time:
 *   hours = (ship-clock delta) − (minutes clocks were advanced) / 60
 * so a noon-to-noon after clocks +1 h is 23 h, not 24 h.
 */
(function (global) {
  'use strict';

  const TZ_MIN = -12 * 60;
  const TZ_MAX = 14 * 60;
  const TZ_STEP = 30;

  function clampTzOffsetMin(min) {
    const n = Number(min);
    if (!isFinite(n)) return 0;
    const stepped = Math.round(n / TZ_STEP) * TZ_STEP;
    return Math.max(TZ_MIN, Math.min(TZ_MAX, stepped));
  }

  function tzOffsetOptions() {
    const out = [];
    for (let m = TZ_MIN; m <= TZ_MAX; m += TZ_STEP) out.push(m);
    return out;
  }

  function formatTzOffset(min) {
    const n = clampTzOffsetMin(min);
    const sign = n >= 0 ? '+' : '-';
    const abs = Math.abs(n);
    const h = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    return 'UTC' + sign + h + ':' + mm;
  }

  function formatClockChange(min) {
    const n = Number(min) || 0;
    if (!n) return 'No clock change this period.';
    const abs = Math.abs(n);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    const parts = [];
    if (h) parts.push(h === 1 ? '1 hour' : h + ' hours');
    if (m) parts.push(m + ' min');
    return (n > 0 ? 'Clocks advanced ' : 'Clocks retarded ') + parts.join(' ') +
      '. Period hours are adjusted so consumption and RPM stay on actual time.';
  }

  function formatClockChangeShort(min) {
    const n = Number(min) || 0;
    if (!n) return '';
    const abs = Math.abs(n);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    let body = '';
    if (h && m) body = h + 'h ' + m + 'm';
    else if (h) body = h + 'h';
    else body = m + 'm';
    return (n > 0 ? 'clocks +' : 'clocks −') + body;
  }

  function toDatetimeLocalValue(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return '';
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function addMinutesToDatetimeLocal(value, minutes) {
    if (!value) return value || '';
    const delta = Number(minutes) || 0;
    if (!delta) return value;
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    d.setMinutes(d.getMinutes() + delta);
    return toDatetimeLocalValue(d);
  }

  /**
   * Actual hours between two ship's-clock stamps after applying a clock change
   * recorded on the later entry (positive = clocks advanced).
   */
  function elapsedShipHours(prevDt, curDt, clockChangeMin) {
    if (!prevDt || !curDt) return null;
    const naive = (new Date(curDt) - new Date(prevDt)) / 3600000;
    if (!isFinite(naive)) return null;
    const adj = naive - (Number(clockChangeMin) || 0) / 60;
    return adj > 0 ? adj : null;
  }

  /**
   * Changing ship's zone adjusts the displayed ship's clock by the same
   * minutes and accumulates that on the period's clock-change log.
   */
  function applyTimezoneChange(datetime, fromOffsetMin, toOffsetMin, prevClockChangeMin) {
    const from = clampTzOffsetMin(fromOffsetMin);
    const to = clampTzOffsetMin(toOffsetMin);
    const deltaMin = to - from;
    return {
      datetime: addMinutesToDatetimeLocal(datetime, deltaMin),
      tzOffsetMin: to,
      clockChangeMin: (Number(prevClockChangeMin) || 0) + deltaMin,
      deltaMin: deltaMin
    };
  }

  const api = {
    TZ_MIN: TZ_MIN,
    TZ_MAX: TZ_MAX,
    TZ_STEP: TZ_STEP,
    clampTzOffsetMin: clampTzOffsetMin,
    tzOffsetOptions: tzOffsetOptions,
    formatTzOffset: formatTzOffset,
    formatClockChange: formatClockChange,
    formatClockChangeShort: formatClockChangeShort,
    toDatetimeLocalValue: toDatetimeLocalValue,
    addMinutesToDatetimeLocal: addMinutesToDatetimeLocal,
    elapsedShipHours: elapsedShipHours,
    applyTimezoneChange: applyTimezoneChange
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  global.ShipTime = api;
})(typeof window !== 'undefined' ? window : global);
