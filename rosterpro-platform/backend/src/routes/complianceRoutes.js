const express = require("express");
const ctrl = require("../controllers/complianceController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const {
  qualificationSchema, licenseSchema, trainingSchema, authorizationSchema,
} = require("../validators/complianceValidators");

const router = express.Router();
router.use(requireAuth);

router.get("/summary/:userId", requirePermission("qualification", "read"), ctrl.summary);

router.get("/qualifications/expiring", requirePermission("qualification", "read"), ctrl.expiringQualifications);
router.get("/qualifications/:userId", requirePermission("qualification", "read"), ctrl.listQualifications);
router.post("/qualifications", requirePermission("qualification", "create"), validate(qualificationSchema), ctrl.createQualification);
router.patch("/qualifications/:id", requirePermission("qualification", "update"), ctrl.updateQualification);
router.delete("/qualifications/:id", requirePermission("qualification", "update"), ctrl.deleteQualification);

router.get("/licenses/expiring", requirePermission("license", "read"), ctrl.expiringLicenses);
router.get("/licenses/:userId", requirePermission("license", "read"), ctrl.listLicenses);
router.post("/licenses", requirePermission("license", "create"), validate(licenseSchema), ctrl.createLicense);
router.patch("/licenses/:id", requirePermission("license", "update"), ctrl.updateLicense);

router.get("/trainings/:userId", requirePermission("training", "read"), ctrl.listTraining);
router.post("/trainings", requirePermission("training", "create"), validate(trainingSchema), ctrl.createTraining);

router.get("/authorizations/:userId", requirePermission("qualification", "read"), ctrl.listAuthorizations);
router.post("/authorizations", requirePermission("qualification", "create"), validate(authorizationSchema), ctrl.createAuthorization);

module.exports = router;
