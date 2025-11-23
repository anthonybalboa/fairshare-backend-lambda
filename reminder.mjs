// reminder.mjs - scheduled bill reminder Lambda

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { publishBillReminder } from "./sns.mjs";

const TABLE_NAME = process.env.TABLE_NAME || "roomsplit";

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

export const handler = async () => {
  console.log("Running bill reminder job...");

  // 1) Get all bill items (SK starts with BILL#)
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
  console.log("Found bills:", bills.length);

  const unpaidLines = [];
  let totalOwed = 0;

  for (const b of bills) {
    const groupId = b.PK.replace("GROUP#", "");
    const billId = b.SK.replace("BILL#", "");
    const desc = b.description || "Unnamed bill";
    const due = b.dueDate || "N/A";
    const shares = b.shares || [];

    for (const s of shares) {
      if (s.status && s.status.toLowerCase() === "paid") continue;

      const userId = s.userId || "unknown-user";
      const amount = Number(s.amount || 0);
      totalOwed += amount;

      unpaidLines.push(
        `${userId} owes $${amount} for "${desc}" in group ${groupId} (bill ${billId}), due ${due}`
      );
    }
  }

  if (unpaidLines.length === 0) {
    console.log("No unpaid shares, skipping SNS publish.");
    return {
      status: "ok",
      message: "No unpaid shares",
    };
  }

  const message =
    `Housemate bill reminder\n\n` +
    `There are ${unpaidLines.length} unpaid shares (approx total $${totalOwed}).\n\n` +
    `Details:\n` +
    unpaidLines.join("\n");

  await publishBillReminder(message);

  console.log("Reminder published. Lines:", unpaidLines.length);

  return {
    status: "ok",
    reminders: unpaidLines.length,
  };
};
