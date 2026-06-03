import assert from "node:assert/strict";
import test from "node:test";
import { taxmateContractSignatures } from "../src/blockchain/taxmateContract.js";

test("Taxmate signatures include required contract methods", () => {
  assert.ok(taxmateContractSignatures.registerTaxpayer.includes("registerTaxpayer"));
  assert.ok(taxmateContractSignatures.registerBusiness.includes("registerBusiness"));
  assert.ok(taxmateContractSignatures.recordTaxPayment.includes("recordTaxPayment"));
  assert.ok(taxmateContractSignatures.createTaxItem.includes("createTaxItem"));
  assert.ok(taxmateContractSignatures.updateTaxItem.includes("updateTaxItem"));
});
