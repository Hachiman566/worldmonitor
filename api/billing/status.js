import { billingHandlers } from '../_billing-runtime.js';
export default { fetch(request) { return billingHandlers().status(request); } };
