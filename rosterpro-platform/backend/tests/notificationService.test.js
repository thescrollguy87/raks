jest.mock("../src/repositories/notificationRepository");
jest.mock("../src/services/emailService");
jest.mock("../src/services/whatsappService");

const notificationRepo = require("../src/repositories/notificationRepository");
const emailService = require("../src/services/emailService");
const whatsappService = require("../src/services/whatsappService");
const notificationService = require("../src/services/notificationService");

const user = { id: "u1", email: "staff@amd.example", phone: "+919876543210" };

beforeEach(() => {
  notificationRepo.create.mockResolvedValue({ id: "notif-1" });
});

describe("notificationService.dispatch", () => {
  it("records the notification, sends it, and marks it sent on success", async () => {
    emailService.send.mockResolvedValue();
    const result = await notificationService.dispatch(user, "EMAIL", "change_alert", "Subject", "Body");

    expect(result.sent).toBe(true);
    expect(notificationRepo.create).toHaveBeenCalledWith({ userId: "u1", channel: "EMAIL", kind: "change_alert", subject: "Subject", body: "Body" });
    expect(emailService.send).toHaveBeenCalledWith(user.email, "Subject", expect.any(String), "Body");
    expect(notificationRepo.markSent).toHaveBeenCalledWith("notif-1");
  });

  it("marks failed and returns sent=false without throwing when delivery fails", async () => {
    emailService.send.mockRejectedValue(new Error("SMTP down"));
    const result = await notificationService.dispatch(user, "EMAIL", "change_alert", "Subject", "Body");

    expect(result.sent).toBe(false);
    expect(notificationRepo.markFailed).toHaveBeenCalledWith("notif-1", expect.any(Error));
    expect(notificationRepo.markSent).not.toHaveBeenCalled();
  });

  it("never throws — a notification failure must never break the calling business operation", async () => {
    emailService.send.mockRejectedValue(new Error("boom"));
    await expect(notificationService.dispatch(user, "EMAIL", "kind", "s", "b")).resolves.not.toThrow();
  });

  it("routes WHATSAPP channel to whatsappService with the phone number", async () => {
    whatsappService.send.mockResolvedValue();
    await notificationService.dispatch(user, "WHATSAPP", "change_alert", null, "Body");
    expect(whatsappService.send).toHaveBeenCalledWith(user.phone, "Body");
  });

  it("skips cleanly when the user has no id", async () => {
    const result = await notificationService.dispatch(null, "EMAIL", "kind", "s", "b");
    expect(result.skipped).toBe(true);
    expect(notificationRepo.create).not.toHaveBeenCalled();
  });
});

describe("notificationService.dispatchAll", () => {
  it("fires every channel independently — one failing doesn't block the others", async () => {
    emailService.send.mockRejectedValue(new Error("email down"));
    whatsappService.send.mockResolvedValue();

    const results = await notificationService.dispatchAll(user, ["EMAIL", "WHATSAPP"], "change_alert", "s", "b");

    expect(results[0].sent).toBe(false);
    expect(results[1].sent).toBe(true);
  });
});

describe("notificationService.notifyShiftChanged", () => {
  it("fires both email and WhatsApp for a shift change", async () => {
    emailService.send.mockResolvedValue();
    whatsappService.send.mockResolvedValue();

    await notificationService.notifyShiftChanged(user, { shiftDate: "2026-09-05", oldCode: "M", newCode: "N" });

    const channels = notificationRepo.create.mock.calls.map(c => c[0].channel);
    expect(channels).toEqual(expect.arrayContaining(["EMAIL", "WHATSAPP"]));
  });
});

describe("notificationService.notifyDailyShiftReminder", () => {
  it("does not send a duplicate reminder already sent today", async () => {
    notificationRepo.findSentToday.mockResolvedValue({ id: "already-sent" });
    const result = await notificationService.notifyDailyShiftReminder(user, { shiftDate: "2026-09-05", shiftLabel: "Morning" });

    expect(result.skipped).toBe(true);
    expect(notificationRepo.create).not.toHaveBeenCalled();
  });

  it("sends normally when nothing was sent today yet", async () => {
    notificationRepo.findSentToday.mockResolvedValue(null);
    emailService.send.mockResolvedValue();

    const result = await notificationService.notifyDailyShiftReminder(user, { shiftDate: "2026-09-05", shiftLabel: "Morning" });
    expect(result.sent).toBe(true);
  });
});
