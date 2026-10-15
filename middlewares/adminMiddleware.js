module.exports = function adminMiddleware(req, res, next) {
  if (req.user?.role === "admin") return next();
  return res
    .status(403)
    .json({ success: false, message: "Administrator access is required." });
};
