# Removal of "New Stock Order" from Production Orders

*20 November 2026 — Client decision to remove manual "New Stock Order" creation from Production → Orders (`localhost:5173/production/orders`).*

## Background & Decision

On 5 November 2026, a "New Stock Order" dialog was added to the Production → Orders page (`OrderManagement.jsx`) allowing users to manually create stock build orders for Machines, Child Parts, and Sub Child Parts.

**Client decision (20 Nov 2026):**
Remove the "New Stock Order" functionality from Production Orders. Production orders should originate solely through standard automated and sales channels:
1. **Customer Orders:** Triggered from Store notifications via sales orders (Leads → Order Form → Store).
2. **Automated Low-Stock Sweeps:** Scheduled reorder sweeps for Machines, Child Parts, and Sub Child Parts based on R&D/Store Min Stock rules.
3. **BOM Cascades:** Automatic child part and sub child part order generation when higher-tier orders require components.
4. **QC Rebuilds:** Rebuild orders initiated via QC rejected flows.

Production floor users should not manually raise arbitrary stock build orders on the Order Management page.

---

## What Was Removed

### 1. Frontend (`Samtek-Frontend`)

**File:** `client/src/pages/production/OrderManagement.jsx`
- **Header Action Button:**
  - Removed `{canAdd && (<Button onClick={() => setAddOpen(true)}>...<Plus ... /> New Stock Order</Button>)}`.
- **Dialog & Form:**
  - Removed `<NewStockOrderDialog open={addOpen} onOpenChange={setAddOpen} startKind={orderTab} />`.
  - Removed the `NewStockOrderDialog` component definition, which contained:
    - `useQuery(['stock-order-items', orderKind])` pick list fetch.
    - `useMutation` calling `POST /api/production-mfg/orders`.
    - Type selector (`Machine`, `ChildPart`, `SubChildPart`).
    - Searchable item picker (Command / Popover combobox).
    - Quantity, priority, and delivery date inputs.
- **State & Helpers:**
  - Removed `addOpen` state.
  - Removed `emptyStockOrder` initial form constant.
  - Removed `stockOrderSummary` toast message helper.
  - Removed `STOCK_ORDER_KINDS` definition in this file.
  - Removed unused `canAdd` permission check (`hasFeatureAccess('production', 'orders', 'add')`).
- **Unused Imports Cleaned Up:**
  - `@/components/ui/command` (`Command`, `CommandEmpty`, `CommandGroup`, `CommandInput`, `CommandItem`, `CommandList`).
  - `@/components/ui/popover` (`Popover`, `PopoverContent`, `PopoverTrigger`).
  - `@/components/ui/dialog` (`DialogFooter`).
  - `@/hooks/use-toast` (`useToast`).
  - `@/hooks/usePermissions` (`usePermissions`).
  - `@/lib/queryClient` (`apiRequest`).
  - `@tanstack/react-query` (`useQuery`, `useMutation`, `useQueryClient`).
  - `lucide-react` (`Plus`, `ChevronDown`, `Check`).

---

### 2. Backend (`Samtek-Backend`)

**File 1:** `server/routes/productionMfgRoutes.js`
- **Routes Removed:**
  - `POST /api/production-mfg/orders` (`ordersAdd`, `createOrder`)
  - `GET /api/production-mfg/stock-order-items` (`ordersView`, `getStockOrderItems`)
- **Controller Imports Cleaned Up:**
  - Removed `createOrder` and `getStockOrderItems` from imports.

**File 2:** `server/controllers/productionMfgController.js`
- **Controller Functions Removed:**
  - `getStockOrderItems`: pick list generator that retrieved released, non-discontinued items with BOMs.
  - `createOrder`: endpoint handler for creating manual stock orders.
  - `notStockOrderable`: validation function for items in the manual form.
  - `STOCK_ORDER_KINDS`: constant array `['Machine', 'ChildPart', 'SubChildPart']`.
- **Unused Imports Cleaned Up:**
  - `createChildPartOrderForItem` (from `childPartReorderService.js`)
  - `createSubChildPartOrderForItem` (from `subChildPartOrderService.js`)
  - `isBought` (from `makeBuyService.js`)
  - `SubChildPartJobWorkOrder` (from `models/SubChildPartJobWorkOrder.js`)
  - `machineStockProblem`, `createMachineStockOrder` (from `machineReorderService.js`)
  - `flattenProcessDefinition` (from `processStepBuilderService.js`)
  - `isReleased` (from `productApprovalService.js`)
  - `ChildPartBOM` (from `models/ChildPartBOM.js`)

---

## What Was NOT Removed (Preserved Workflows)

1. **`services/machineReorderService.js`:**
   - `createMachineStockOrder` and `machineStockProblem` remain intact: they are used by `runMachineLowStockSweep` (cron job) to raise build orders automatically when machine stock falls below Min Stock.
2. **`services/childPartReorderService.js` & `services/subChildPartOrderService.js`:**
   - `createChildPartOrderForItem` and `createSubChildPartOrderForItem` remain intact for low-stock sweeps and BOM parent cascades.
3. **`ProductionOrder` Model & Records:**
   - Existing orders with `source: 'Stock'` remain in the database and continue to be listed and processed through the production lifecycle.
4. **Permissions:**
   - Permission check `ordersAdd` remains active in `productionMfgRoutes.js` for material request routes (`/orders/:id/sub-child-part-material/request` and `/orders/:id/machine-material/request`).
