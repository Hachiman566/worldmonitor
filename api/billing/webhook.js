import { billingDependencies } from '../_billing-runtime.js';
import { handleWebhook } from '../_billing-state.js';
export default { fetch(request) { return handleWebhook(request, billingDependencies()); } };
