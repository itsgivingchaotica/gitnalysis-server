const authenticateUser = (req, res, next) => {
  try {
    if (req.isAuthenticated()) {
      console.log(req);
      // If the user is authenticated, allow them to proceed
      return next();
    }
    // If the user is not authenticated, send an unauthorized response
    res.status(401).send("Unauthorized");
  } catch (error) {
    // Handle any errors that occur during authentication
    console.error("Error in authentication middleware:", error);
    res.status(500).send("Internal Server Error");
  }
};

module.exports = authenticateUser;
