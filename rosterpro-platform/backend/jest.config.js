module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  collectCoverageFrom: ["src/services/**/*.js", "src/utils/**/*.js"],
  clearMocks: true,
};
