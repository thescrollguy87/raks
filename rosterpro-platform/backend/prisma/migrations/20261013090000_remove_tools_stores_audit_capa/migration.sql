-- Removes the Tools & Stores and Audit & CAPA modules: neither had any
-- backend routes/controllers/UI (fully unused schema scaffolding), except
-- for one safety check in userRepository.findDeleteBlockers that is being
-- removed in the same change. Dropping child tables before their parents
-- to satisfy FK dependencies; DROP TABLE removes its own indexes and FK
-- constraints automatically.

-- DropTable (Tool control & calibration)
DROP TABLE "tool_calibration_logs";
DROP TABLE "tool_issues";
DROP TABLE "tools";

-- DropTable (Stores / inventory)
DROP TABLE "store_movements";
DROP TABLE "store_items";

-- DropTable (Quality: audit findings & CAPA)
DROP TABLE "capas";
DROP TABLE "audit_findings";

-- DropEnum
DROP TYPE "ToolCalibrationStatus";
DROP TYPE "CapaStatus";
