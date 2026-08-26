process.env.NODE_ENV = "test";

const request = require("supertest");
const app = require("../server");

describe("Backend API Tests", () => {
  test("GET / should return backend running message", async () => {
    const response = await request(app).get("/");

    expect(response.statusCode).toBe(200);
    expect(response.text).toContain("Backend is Running");
  });
});