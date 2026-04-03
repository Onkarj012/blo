import assert from "node:assert/strict";
import test from "node:test";

import { buildDisplayAddress, buildGeocodeQuery, detectAreaCluster } from "@/lib/address";

test("buildDisplayAddress trims OCR noise into compact display text", () => {
  assert.equal(
    buildDisplayAddress(
      "Flat No C 602 Lakshadeep Palace Kunal Icon Road Pimple Saudagar Haveli, Unie 4 At 602 Mardta Uta Gone Sigela Ds Fives Ater Gaet"
    ),
    "Flat No C 602 Lakshadeep Palace Kunal Icon Road Pimple Saudagar Haveli"
  );
});

test("detectAreaCluster picks known society clusters", () => {
  assert.equal(
    detectAreaCluster("Flat X-402 Roseland Residency Kunal Icon Road Pimple Saudagar"),
    "Roseland Residency"
  );
  assert.equal(
    detectAreaCluster("Sn -100/101 Alcove Society Flat No E-104 Pimple Saudagar"),
    "Alcove"
  );
});

test("buildGeocodeQuery falls back to the central area", () => {
  assert.equal(
    buildGeocodeQuery("Pimple Saudagar Core"),
    "Pimple Saudagar, Pune, Maharashtra, India"
  );
});
