// قراءة مواقع الفروع من الإحداثيات وروابط خرائط Google
import { test } from "node:test";
import assert from "node:assert/strict";

const g = await import("../../src/lib/geo.ts");

test("قراءة الإحداثيات والروابط الشائعة", () => {
  assert.deepEqual(g.parseLocation("24.7136, 46.6753"), { lat: 24.7136, lng: 46.6753 });
  assert.deepEqual(g.parseLocation("21.5433،39.1728"), { lat: 21.5433, lng: 39.1728 });
  assert.deepEqual(g.parseLocation("https://www.google.com/maps/@24.7135517,46.6752957,15z"), { lat: 24.713552, lng: 46.675296 });
  assert.deepEqual(g.parseLocation("https://www.google.com/maps/place/X/@24.1,46.2,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d24.774265!4d46.738586"), { lat: 24.774265, lng: 46.738586 });
  assert.deepEqual(g.parseLocation("https://maps.google.com/?q=26.4207,50.0888"), { lat: 26.4207, lng: 50.0888 });
  assert.equal(g.parseLocation("https://maps.app.goo.gl/abc123"), null);
  assert.equal(g.parseLocation("95, 46"), null);
  assert.equal(g.parseLocation("الرياض"), null);
});

test("روابط الاتجاهات", () => {
  assert.equal(g.directionsUrl({ lat: 24.7, lng: 46.6 }), "https://www.google.com/maps/dir/?api=1&destination=24.7,46.6");
  assert.deepEqual(g.validLatLng("24.1234567", "46"), { lat: 24.123457, lng: 46 });
  assert.equal(g.validLatLng("", "46"), null);
});
