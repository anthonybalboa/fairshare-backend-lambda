// index.mjs — DynamoDB version with CORS

import crypto from "crypto";
import {
  createGroupInDb,
  listGroupsForUser,
  getGroupFromDb,
  createBillInDb,
  listBillsForGroup,
  getBillFromDb,
  getSummaryForUser,
  addMemberToGroup,
  updateShareStatus,
} from "./db.mjs";

import { subscribeEmailToTopic } from "./sns.mjs";


function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS,PATCH",
    },
    body: JSON.stringify(body, null, 2),
  };
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

function matchPath(path, template) {
  const pParts = path.split("/").filter(Boolean);
  const tParts = template.split("/").filter(Boolean);
  if (pParts.length !== tParts.length) return null;

  const params = {};
  for (let i = 0; i < pParts.length; i++) {
    const t = tParts[i];
    const p = pParts[i];
    if (t.startsWith("{") && t.endsWith("}")) {
      params[t.slice(1, -1)] = p;
    } else if (t !== p) {
      return null;
    }
  }
  return params;
}

function getUserFromEvent(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims
    || event.requestContext?.authorizer?.claims;

  if (!claims) {
    // fallback if authorizer not wired yet
    return {
      userId: "dummy-user",
      email: "dummy@example.com",
      name: "Anthony (Stub Mode)",
    };
  }

  return {
    userId: claims.sub,
    email: claims.email,
    name:
      claims.preferred_username || 
      claims.name ||
      claims["cognito:username"] ||
      claims.email ||
      "Unknown User",
  };
}


export const handler = async (event) => {
  console.log("EVENT:", JSON.stringify(event));
  const path = event.rawPath || event.path || "/";
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  const user = getUserFromEvent(event);

  // CORS preflight
  if (method === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS,PATCH",
      },
      body: "",
    };
  }

  // ===== /me =====
  if (path === "/me" && method === "GET") {
    return json(200, user);
  }

  // ===== /groups (GET) - list groups for current user =====
  if (path === "/groups" && method === "GET") {
    try {
      const groups = await listGroupsForUser(user.userId);
      return json(200, groups);
    } catch (err) {
      console.error("Error listing groups", err);
      return json(500, { message: "Error listing groups" });
    }
  }

  // ===== /groups (POST) - create group =====
  if (path === "/groups" && method === "POST") {
    const body = parseBody(event);
    const name = body.name;
    if (!name) {
      return json(400, { message: "name is required" });
    }

    const groupId = "grp-" + crypto.randomUUID();
    try {
      const item = await createGroupInDb(groupId, user, name);
      return json(201, {
        groupId,
        name: item.name,
        createdBy: item.createdBy,
        createdAt: item.createdAt,
        members: item.members,
      });
    } catch (err) {
      console.error("Error creating group", err);
      return json(500, { message: "Error creating group" });
    }
  }

  // ===== /groups/{groupId} (GET) =====
  {
    const params = matchPath(path, "/groups/{groupId}");
    if (params && method === "GET") {
      const { groupId } = params;
      try {
        const g = await getGroupFromDb(groupId);
        if (!g) {
          return json(404, { message: "Group not found" });
        }
        return json(200, {
          groupId,
          name: g.name,
          createdBy: g.createdBy,
          createdAt: g.createdAt,
          members: g.members || [],
        });
      } catch (err) {
        console.error("Error getting group", err);
        return json(500, { message: "Error getting group" });
      }
    }
  }

    // ===== /groups/{groupId}/join (POST) =====
    {
      const params = matchPath(path, "/groups/{groupId}/join");
      if (params && method === "POST") {
        const { groupId } = params;
        const body = parseBody(event);
        const { userId: bodyUserId, email, name } = body;

        // For now, we trust userId from the body.
        // Later, when Cognito is wired, we'll ignore bodyUserId and use the token.
        const effectiveUser = {
          userId: bodyUserId || user.userId,   // fall back to stub user
          email: email || user.email,
          name: name || user.name,
        };

  
        try {
          // 1) Add to group.members[]
          const updatedGroup = await addMemberToGroup(groupId, effectiveUser);
  
          // 2) Subscribe their email to the reminder topic (best-effort)
          try {
            await subscribeEmailToTopic(effectiveUser.email);
          } catch (e) {
            console.error("SNS subscription failed (non-fatal)", e);
          }
  
          return json(200, {
            groupId,
            name: updatedGroup.name,
            createdBy: updatedGroup.createdBy,
            createdAt: updatedGroup.createdAt,
            members: updatedGroup.members || [],
          });
        } catch (err) {
          console.error("Error joining group", err);
          return json(500, { message: "Error joining group" });
        }
      }
    }
  

  // ===== /groups/{groupId}/bills (POST) =====
  {
    const params = matchPath(path, "/groups/{groupId}/bills");
    if (params && method === "POST") {
      const { groupId } = params;
      const body = parseBody(event);
      const { description, amount, dueDate, shares } = body;

      if (!description || typeof amount !== "number") {
        return json(400, { message: "description and numeric amount are required" });
      }

      const billId = "bill-" + crypto.randomUUID();
      try {
        const billItem = await createBillInDb(groupId, billId, user, {
          description,
          amount,
          dueDate,
          shares,
        });

        return json(201, {
          groupId,
          billId,
          description: billItem.description,
          amount: billItem.amount,
          dueDate: billItem.dueDate,
          createdBy: billItem.createdBy,
          shares: billItem.shares,
        });
      } catch (err) {
        console.error("Error creating bill", err);
        return json(500, { message: "Error creating bill" });
      }
    }
  }

  // ===== /groups/{groupId}/bills (GET) =====
  {
    const params = matchPath(path, "/groups/{groupId}/bills");
    if (params && method === "GET") {
      const { groupId } = params;
      try {
        const bills = await listBillsForGroup(groupId);
        return json(200, bills);
      } catch (err) {
        console.error("Error listing bills", err);
        return json(500, { message: "Error listing bills" });
      }
    }
  }

  // ===== /groups/{groupId}/bills/{billId} (GET) =====
  {
    const params = matchPath(path, "/groups/{groupId}/bills/{billId}");
    if (params && method === "GET") {
      const { groupId, billId } = params;
      try {
        const bill = await getBillFromDb(groupId, billId);
        if (!bill) {
          return json(404, { message: "Bill not found" });
        }
        return json(200, bill);
      } catch (err) {
        console.error("Error getting bill", err);
        return json(500, { message: "Error getting bill" });
      }
    }
  }

  // ===== PATCH /groups/{groupId}/bills/{billId}/shares/{userId} =====
  {
    const params = matchPath(
      path,
      "/groups/{groupId}/bills/{billId}/shares/{userId}"
    );
    if (params && method === "PATCH") {
      const { groupId, billId, userId } = params;
      const body = parseBody(event);
      const { status } = body;

      if (!status) {
        return json(400, { message: "status is required" });
      }

      try {
        const updatedBill = await updateShareStatus(
          groupId,
          billId,
          userId,
          status
        );

        if (!updatedBill) {
          return json(404, { message: "Bill or share not found" });
        }

        return json(200, {
          groupId,
          billId,
          description: updatedBill.description,
          amount: updatedBill.amount,
          dueDate: updatedBill.dueDate,
          createdBy: updatedBill.createdBy,
          createdAt: updatedBill.createdAt,
          shares: updatedBill.shares || [],
        });
      } catch (err) {
        console.error("Error updating share status", err);
        return json(500, { message: "Error updating share status" });
      }
    }
  }
  

  // ===== /me/summary (GET) =====
  if (path === "/me/summary" && method === "GET") {
    try {
      const summary = await getSummaryForUser(user.userId);
      return json(200, summary);
    } catch (err) {
      console.error("Error getting summary", err);
      return json(500, { message: "Error getting summary" });
    }
  }

  // Fallback
  return json(404, { message: "Not found", path, method });
};
