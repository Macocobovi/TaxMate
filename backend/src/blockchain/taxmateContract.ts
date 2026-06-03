export const taxmateContractSignatures = {
  registerTaxpayer:
    "registerTaxpayer(address,string,string,string,string,string,string,string,string,string)",
  registerBusiness:
    "registerBusiness(address,string,string,string,string,string,string,string,string,string,string,string,string,string,string,string,bool)",
  createTaxItem: "createTaxItem(string,string,uint8,uint256)",
  updateTaxItem: "updateTaxItem(uint256,bool)",
  recordTaxPayment: "recordTaxPayment(address,string,uint256,uint256,string,string)",
  getActiveTaxItems: "getActiveTaxItems()"
};

export const circleExecutionMap = {
  userRegistration: taxmateContractSignatures.registerTaxpayer,
  businessRegistration: taxmateContractSignatures.registerBusiness,
  paymentRecord: taxmateContractSignatures.recordTaxPayment,
  taxItemCreate: taxmateContractSignatures.createTaxItem,
  taxItemToggle: taxmateContractSignatures.updateTaxItem
};
