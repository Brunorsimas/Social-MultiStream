import { type User, type InsertUser } from "@shared/schema";
import { randomUUID } from "crypto";
import { hashPassword, verifyPassword } from "./password-security";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  verifyUserPassword(
    username: string,
    password: string,
  ): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;

  constructor() {
    this.users = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async verifyUserPassword(
    username: string,
    password: string,
  ): Promise<User | undefined> {
    const user = await this.getUserByUsername(username);
    if (!user || !(await verifyPassword(password, user.password))) {
      return undefined;
    }
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = {
      ...insertUser,
      id,
      password: await hashPassword(insertUser.password),
    };
    this.users.set(id, user);
    return user;
  }
}

export const storage = new MemStorage();
