// db.mjs - DynamoDB helpers for roomsplit table

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env.TABLE_NAME || "roomsplit";

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

// Helper to build keys
function groupPk(groupId) {
  return `GROUP#${groupId}`;
}
function groupDetailsSk() {
  return "DETAILS";
}
function billSk(billId) {
  return `BILL#${billId}`;
}

/**
 * GROUPS
 */

// Create a new group with the creator as owner in members[]
export async function createGroupInDb(groupId, user, name) {
  const now = new Date().toISOString();

  // Full member object for creator (matches addMemberToGroup shape)
  const creatorMember = {
    userId: user.userId,
    email: user.email || null,
    name: user.name || null,
    role: "owner",
    joinedAt: now,
  };

  const item = {
    PK: groupPk(groupId),
    SK: groupDetailsSk(),
    name,
    createdBy: user.userId,
    createdAt: now,
    members: [creatorMember],
  };

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
      ConditionExpression:
        "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    })
  );

  return item;
}


// Get a single group (with members array)
export async function getGroupFromDb(groupId) {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: groupPk(groupId),
        SK: groupDetailsSk(),
      },
    })
  );
  return res.Item || null;
}

// List groups where a user is in members[]
// (Scan + FilterExpression – OK for small student project)
export async function listGroupsForUser(userId) {
  const res = await ddb.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "#sk = :details",
      ExpressionAttributeNames: {
        "#sk": "SK",
      },
      ExpressionAttributeValues: {
        ":details": "DETAILS",
      },
    })
  );

  const groups = (res.Items || []).filter((g) =>
    Array.isArray(g.members) && g.members.some((m) => m.userId === userId)
  );

  // Shape it a bit for API response
  return groups.map((g) => ({
    groupId: g.PK.replace("GROUP#", ""),
    name: g.name,
    createdBy: g.createdBy,
    createdAt: g.createdAt,
    members: g.members,
    role: g.members.find((m) => m.userId === userId)?.role || "member",
  }));
}

// Add a member to a group (creates members[] list if missing)
export async function addMemberToGroup(groupId, member) {
    const now = new Date().toISOString();
    const newMember = {
      userId: member.userId,
      email: member.email || null,
      name: member.name || null,
      role: member.role || "member",
      joinedAt: now,
    };
  
    const res = await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: groupPk(groupId),
          SK: groupDetailsSk(),
        },
        UpdateExpression:
          "SET members = list_append(if_not_exists(members, :empty), :m)",
        ExpressionAttributeValues: {
          ":empty": [],
          ":m": [newMember],
        },
        ReturnValues: "ALL_NEW",
      })
    );
  
    return res.Attributes;
  }
  

/**
 * BILLS
 */

// Create a bill; frontend sends shares[]
export async function createBillInDb(groupId, billId, user, billInput) {
  const { description, amount, dueDate, shares } = billInput;
  const now = new Date().toISOString();

  const item = {
    PK: groupPk(groupId),
    SK: billSk(billId),
    description,
    amount,
    dueDate: dueDate || null,
    createdBy: user.userId,
    createdAt: now,
    shares: shares || [], // [{ userId, amount, status }]
  };

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    })
  );

  return item;
}

// List bills in a group
export async function listBillsForGroup(groupId) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(#sk, :billPrefix)",
      ExpressionAttributeNames: {
        "#sk": "SK",
      },
      ExpressionAttributeValues: {
        ":pk": groupPk(groupId),
        ":billPrefix": "BILL#",
      },
    })
  );

  const bills = res.Items || [];
  return bills.map((b) => ({
    groupId,
    billId: b.SK.replace("BILL#", ""),
    description: b.description,
    amount: b.amount,
    dueDate: b.dueDate,
    createdBy: b.createdBy,
    createdAt: b.createdAt,
    shares: b.shares || [], 
  }));
}


// Get one bill (with shares[])
export async function getBillFromDb(groupId, billId) {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: groupPk(groupId),
        SK: billSk(billId),
      },
    })
  );
  const b = res.Item;
  if (!b) return null;

  return {
    groupId,
    billId: billId,
    description: b.description,
    amount: b.amount,
    dueDate: b.dueDate,
    createdBy: b.createdBy,
    createdAt: b.createdAt,
    shares: b.shares || [],
  };
}

// Update a single share's status in a bill
export async function updateShareStatus(groupId, billId, userId, status) {
    // 1) Load bill
    const res = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: groupPk(groupId),
          SK: billSk(billId),
        },
      })
    );
  
    const bill = res.Item;
    if (!bill) return null;
  
    const shares = bill.shares || [];
    const idx = shares.findIndex((s) => s.userId === userId);
    if (idx === -1) {
      return null;
    }
  
    shares[idx] = {
      ...shares[idx],
      status,
    };
  
    bill.shares = shares;
  
    // 2) Save whole bill back (simple for project scale)
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: bill,
      })
    );
  
    return bill;
  }
  

/**
 * SUMMARY FOR A USER (simple scan-based)
 * For demo: scan all bills and aggregate shares for the given userId.
 */
export async function getSummaryForUser(userId) {
  // Scan only items whose SK begins with BILL#
  const res = await ddb.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "begins_with(#sk, :billPrefix)",
      ExpressionAttributeNames: {
        "#sk": "SK",
      },
      ExpressionAttributeValues: {
        ":billPrefix": "BILL#",
      },
    })
  );

  const bills = res.Items || [];
  let totalOwed = 0;
  const perBill = [];

  for (const b of bills) {
    const groupId = b.PK.replace("GROUP#", "");
    const billId = b.SK.replace("BILL#", "");
    const shares = b.shares || [];

    const myShare = shares.find((s) => s.userId === userId);
    if (myShare && myShare.status !== "paid") {
      totalOwed += myShare.amount;
      perBill.push({
        groupId,
        billId,
        description: b.description,
        amount: b.amount,
        dueDate: b.dueDate,
        myAmount: myShare.amount,
        status: myShare.status,
      });
    }
  }

  return {
    userId,
    totalOwed,
    bills: perBill,
  };
}
