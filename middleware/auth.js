const authenticateUser = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: "Not logged in to Gitnalysis" });
};

module.exports = authenticateUser;
