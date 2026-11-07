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

test("الدرجات والدقائق والثواني والعشري بالاتجاه", () => {
  assert.deepEqual(g.parseLocation(`24°44'12.8"N 46°50'06.9"E`), { lat: 24.736889, lng: 46.835250 });
  assert.deepEqual(g.parseLocation("24°44′12.8″N 46°50′06.9″E"), { lat: 24.736889, lng: 46.835250 });
  assert.deepEqual(g.parseLocation(`N 24°44'12.8" E 46°50'06.9"`), { lat: 24.736889, lng: 46.835250 });
  assert.deepEqual(g.parseLocation(`33°51'31.0"S 151°12'51.0"E`), { lat: -33.858611, lng: 151.214167 });
  assert.deepEqual(g.parseLocation("24.7368° N, 46.8352° E"), { lat: 24.7368, lng: 46.8352 });
  assert.equal(g.parseLocation(`91°00'00"N 46°00'00"E`), null);
});

test("تصنيف المدخل دون رفض أي صيغة", () => {
  assert.equal(g.classifyLocation("https://maps.app.goo.gl/DQnp2ja91HvUZC3A6?g_st=aw"), "short_link");
  assert.equal(g.classifyLocation(`24°44'12.8"N 46°50'06.9"E`), "coordinates");
  assert.equal(g.classifyLocation("8056-7958 الهفوف، النسيم الشرقي، الرياض 14243"), "address");
  assert.equal(g.classifyLocation("https://www.google.com/maps/place/Riyadh"), "map_link");
  assert.equal(g.classifyLocation("https://example.com/x"), "link");
  assert.equal(g.classifyLocation("  "), "empty");
  assert.equal(g.classifyLocation("100% خطأ %E0%A4%A"), "address");
  assert.equal(g.isShortMapsUrl("https://maps.app.goo.gl/abc"), true);
  assert.equal(g.isShortMapsUrl("https://goo.gl/maps/abc"), true);
  assert.equal(g.isShortMapsUrl("https://goo.gl/other"), false);
});

test("فتح الموقع: الإحداثيات ثم النص كما هو ثم البحث بالعنوان", () => {
  assert.equal(g.locationHref({ latitude: 24.1, longitude: 46.2, location_text: "أي نص" }), "https://www.google.com/maps/search/?api=1&query=24.1,46.2");
  assert.equal(g.locationHref({ location_text: `24°44'12.8"N 46°50'06.9"E` }), "https://www.google.com/maps/search/?api=1&query=24.736889,46.83525");
  assert.equal(g.locationHref({ location_text: "https://maps.app.goo.gl/DQnp2ja91HvUZC3A6?g_st=aw" }), "https://maps.app.goo.gl/DQnp2ja91HvUZC3A6?g_st=aw");
  const addr = "8056-7958 الهفوف، النسيم الشرقي، الرياض 14243";
  assert.equal(g.locationHref({ location_text: addr }), `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`);
  assert.equal(g.locationHref({ location_text: "javascript:alert(1)" }), null);
  assert.equal(g.locationHref({ address: "شارع الملك فهد", city: "الرياض" }), `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("شارع الملك فهد، الرياض")}`);
  assert.equal(g.locationHref({}), null);
  assert.equal(g.directionsHref({ location_text: addr }), `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`);
});
