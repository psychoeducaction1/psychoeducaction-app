/* Remplacer utm() et emitBookingSubmitted() dans le script du formulaire.
 * Dans task.then(...), appeler emitIntakeSubmitted(result, type) pour LES DEUX types.
 * Installer aussi wordpress-acquisition-tracking.js globalement, avant ce formulaire.
 */
function utm() {
  if (window.peaAcquisition) return window.peaAcquisition.attribution();
  // The form remains usable if the global script fails; only this page's parameters survive.
  var query = new URLSearchParams(window.location.search);
  var result = {};
  ['source', 'medium', 'campaign', 'term', 'content', 'id'].forEach(function (key) {
    var value = query.get('utm_' + key);
    if (value) result[key] = value.slice(0, 120);
  });
  ['gclid', 'gbraid', 'wbraid', 'fbclid'].forEach(function (key) {
    var value = query.get(key);
    if (value) result[key] = value.slice(0, 120);
  });
  return result;
}

var emittedIntakeEvents = {};
function emitIntakeSubmitted(result, contactType) {
  // Tracking must never turn a confirmed booking into an apparent submission failure.
  try {
    if (window.peaAcquisition) return window.peaAcquisition.emitIntakeSuccess(result, contactType);
    if (!result || result.success !== true) return false;
    var eventName = contactType === 'scheduled_call' ? 'booking_form_submitted' :
      contactType === 'rapid_callback' ? 'rapid_callback_submitted' : null;
    var id = result.conversionEventId;
    if (!eventName || typeof id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return false;
    var key = 'pea.' + eventName + '.' + id;
    if (emittedIntakeEvents[key]) return false;
    try { if (window.sessionStorage.getItem(key)) return false; } catch {}
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: eventName, conversion_event_id: id });
    emittedIntakeEvents[key] = true;
    try { window.sessionStorage.setItem(key, '1'); } catch {}
    return true;
  } catch { return false; }
}

// Also exposes the same helpers when installed as a separate script before the form.
window.peaIntakeFormTracking = { attribution: utm, emitIntakeSuccess: emitIntakeSubmitted };
