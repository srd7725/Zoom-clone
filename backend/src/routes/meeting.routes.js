import { Router } from "express";
import { createMeeting, validateMeeting, endMeeting } from "../controllers/meeting.controller.js";

const router = Router();

router.route("/create").post(createMeeting);
router.route("/validate/:meetingCode").get(validateMeeting);
router.route("/end").post(endMeeting);

export default router;
