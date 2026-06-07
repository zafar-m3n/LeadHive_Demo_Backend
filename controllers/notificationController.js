const { Notification } = require("../models");
const { resSuccess, resError } = require("../utils/responseUtil");

const getNotifications = async (req, res) => {
  try {
    const userId = req.user?.id;

    const notifications = await Notification.findAll({
      where: {
        user_id: userId,
      },
      order: [["created_at", "DESC"]],
      limit: 50,
    });

    return resSuccess(res, notifications);
  } catch (err) {
    console.error("GetNotifications Error:", err);
    return resError(res, "Failed to load notifications.", 500);
  }
};

const markNotificationAsRead = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    console.log("Marking notification as read:", { userId, notificationId: id });

    const notification = await Notification.findOne({
      where: {
        id,
        user_id: userId,
      },
    });

    if (!notification) {
      return resError(res, "Notification not found.", 404);
    }

    notification.is_read = true;

    await notification.save();

    return resSuccess(res, notification);
  } catch (err) {
    console.error("MarkNotificationAsRead Error:", err);
    return resError(res, "Failed to mark notification as read.", 500);
  }
};

module.exports = {
  getNotifications,
  markNotificationAsRead,
};
