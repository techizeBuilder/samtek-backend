import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import {
  getWaiting, listTrips, getTrip, postTrip, postCancelTrip, putTripDetails, postDelivered, postPickedUp,
  getStorePending, postStoreHandover, getProductionPending, postProductionHandover,
  listVehicles, postVehicle, putVehicle,
  postVendorReady, postCollected, postShort, getStoreReceive, postStoreReceive, postStoreShort, getAtStore, postHandToProduction,
  getStoreReceived, postBringBack, postCollectLater, postPoLineLater, getPartlyBack, postStoreNotComing,
} from '../controllers/dispatchTripController.js';

// /api/dispatch-trips — outsource-v2 slice 6 (2026-10-20). Three departments
// use this router, so each route carries its own guard (no router.use guard):
//   Dispatch   — dispatches › vendorPickups (view / add / edit)
//   Store      — Store Head / Store Employee (same as the inventory transfers)
//   Production — production › orders (same as Process Execution's actions)
const router = express.Router();
router.use(authenticateToken);

const pickupsView = checkPermission('dispatches', 'vendorPickups', 'view');
const pickupsAdd = checkPermission('dispatches', 'vendorPickups', 'add');
const pickupsEdit = checkPermission('dispatches', 'vendorPickups', 'edit');
const storeOnly = authorizeRoles('Store Head', 'Store Employee');
const ordersView = checkPermission('production', 'orders', 'view');
const ordersEdit = checkPermission('production', 'orders', 'edit');

// Fixed paths first (before /:id).
router.get('/waiting', pickupsView, getWaiting);
router.get('/vehicles', pickupsView, listVehicles);
router.post('/vehicles', pickupsEdit, postVehicle);
router.put('/vehicles/:vehicleId', pickupsEdit, putVehicle);
router.get('/store/pending', storeOnly, getStorePending);
router.get('/store/receive', storeOnly, getStoreReceive);
router.get('/store/received', storeOnly, getStoreReceived);
router.get('/store/at-store', storeOnly, getAtStore);
router.get('/store/partly-back', storeOnly, getPartlyBack); // pieces back in part (2026-10-26)
router.post('/store/not-coming', storeOnly, postStoreNotComing);
router.post('/store/hand-to-production', storeOnly, postHandToProduction);
router.post('/vendor-ready', pickupsEdit, postVendorReady);
router.get('/production/orders/:orderId', ordersView, getProductionPending);

router.get('/', pickupsView, listTrips);
router.post('/', pickupsAdd, postTrip);
router.get('/:id', pickupsView, getTrip);
router.post('/:id/cancel', pickupsEdit, postCancelTrip);
router.put('/:id', pickupsEdit, putTripDetails);               // change vehicle / driver / date (2026-10-24)
router.post('/:id/jobs/:jobId/delivered', pickupsEdit, postDelivered);
router.post('/:id/jobs/:jobId/picked-up', pickupsEdit, postPickedUp);
router.post('/:id/jobs/:jobId/store-handover', storeOnly, postStoreHandover);
router.post('/:id/jobs/:jobId/production-handover', ordersEdit, postProductionHandover);
router.post('/:id/jobs/:jobId/collected', pickupsEdit, postCollected);
router.post('/:id/jobs/:jobId/short', pickupsEdit, postShort);
router.post('/:id/jobs/:jobId/bring-back', pickupsEdit, postBringBack);       // the vehicle waits (2026-10-21)
router.post('/:id/jobs/:jobId/collect-later', pickupsEdit, postCollectLater); // vendor not ready
router.post('/:id/jobs/:jobId/po-line-later', pickupsEdit, postPoLineLater); // one PO line not ready (2026-10-26)
router.post('/:id/jobs/:jobId/store-receive', storeOnly, postStoreReceive);
router.post('/:id/jobs/:jobId/store-short', storeOnly, postStoreShort);

export default router;
