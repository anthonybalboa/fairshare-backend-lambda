// sns.mjs - SNS helper for email subscriptions

import { SNSClient, SubscribeCommand, PublishCommand } from "@aws-sdk/client-sns";

const TOPIC_ARN = process.env.SNS_TOPIC_ARN;
const sns = new SNSClient({});

export async function subscribeEmailToTopic(email) {
  if (!TOPIC_ARN) {
    console.warn("SNS_TOPIC_ARN not set, skipping subscription");
    return;
  }
  if (!email) {
    console.warn("No email provided, skipping subscription");
    return;
  }

  console.log("Subscribing", email, "to", TOPIC_ARN);

  await sns.send(
    new SubscribeCommand({
      TopicArn: TOPIC_ARN,
      Protocol: "email",
      Endpoint: email,
      ReturnSubscriptionArn: true,
    })
  );
}

// publish helper for reminders
export async function publishBillReminder(message, subject = "Housemate bill reminder") {
  if (!TOPIC_ARN) {
    console.warn("SNS_TOPIC_ARN not set, skipping publish");
    return;
  }

  console.log("Publishing reminder to", TOPIC_ARN);

  await sns.send(
    new PublishCommand({
      TopicArn: TOPIC_ARN,
      Subject: subject,
      Message: message,
    })
  );
}
