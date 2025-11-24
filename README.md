# fairshare-backend-lambda
 AWS Lambda Backend for CS 218 Final Project 

Documentation below but originally here: https://docs.google.com/document/d/1r0xvqCcgWvrc2kAM1ty-Xaqxwvl_kU2xWlj8DOxFMaE/edit?tab=t.0

Author: Anthony Chu 
ID: 018302843

Base URL
Because auth is now required, these base urls won't show much anymore (will show unauthorized). Keeping them in documentation for historical purposes. They work great with Cognito when called from frontend (Amplify). 
https://lfesbjfali.execute-api.us-west-1.amazonaws.com

Currently
Groups and bills are stored in a real DynamoDB table (roomsplit) in Anthony’s AWS account.


Authentication via Cognito is now enabled.
Backend reads the logged-in user from Cognito JWT claims (via API Gateway Authorizer):
- userId = claims.sub
- email = claims.email
- name = claims.preferred_username || claims.name || claims["cognito:username"] || claims.email


If Cognito claims are missing (ONLY in local or early testing), backend falls back to:
{
  userId: "dummy-user",
  email: "dummy@example.com",
  name: "Anthony (Stub Mode)"
}



All endpoints expect/return JSON.
When a user calls POST /groups/{groupId}/join with their email, the backend subscribes that email to an SNS topic (housemate-bill-reminder) for future bill reminders. (they still have to go to their email and hit subscribe) 




Available endpoints (for the UI)
1. GET /me
Example:
 GET https://lfesbjfali.execute-api.us-west-1.amazonaws.com/me


Response:


{
  "userId": "dummy-user",
  "email": "dummy@example.com",
  "name": "Anthony (Stub Mode)"
}

Use this to show “current user” in the UI for now before auth is done 

2. GET /groups
Example:
 GET https://lfesbjfali.execute-api.us-west-1.amazonaws.com/groups


Response:


[
  {
    "groupId": "grp-c3796416-567c-4405-bf97-f930e3f52ad8",
    "name": "DB Test Apt",
    "createdBy": "dummy-user",
    "createdAt": "2025-11-20T21:52:13.653Z",
    "members": [
      { "userId": "dummy-user", "role": "owner" }
    ],
    "role": "owner"
  }
]





Show this as the list of all groups / apartments from dynamodb. 

3. POST /groups
URL:
 POST https://lfesbjfali.execute-api.us-west-1.amazonaws.com/groups
Headers:
Content-Type: application/json

Body:
{
  "name": "My Apartment"
}

Response:
{
  "groupId": "grp-<uuid>",
  "name": "My Apartment",
  "createdBy": "<userId-from-auth>",
  "createdAt": "2025-..",
  "members": [
    {
      "userId": "<userId-from-auth>",
      "email": "<email-from-auth>",
      "name": "<name-from-auth>",
      "role": "owner",
      "joinedAt": "2025-.."
    }
  ]
}

Notes:
The creator is automatically added as the first member (owner).



Use this endpoint when a user creates a new household/group.
IF cognito fails, it FALLS BACK to 
{
  userId: "dummy-user",
  email: "dummy@example.com",
  name: "Anthony (Stub Mode)"
}



4. GET /groups/{groupId}
Example:
 GET https://lfesbjfali.execute-api.us-west-1.amazonaws.com/groups/grp-123


Response:


{
  "groupId": "grp-c3796416-567c-4405-bf97-f930e3f52ad8",
  "name": "DB Test Apt",
  "createdBy": "dummy-user",
  "createdAt": "2025-11-20T21:52:13.653Z",
  "members": [
    { "userId": "dummy-user", "role": "owner" }
  ]
}



Use this for the group detail page.

5. GET /groups/{groupId}/bills
Returns the full bill list for a group INCLUDING the shares array:


[
  {
    "groupId": "grp-123",
    "billId": "bill-abc123",
    "description": "Internet",
    "amount": 80,
    "dueDate": "2025-11-15",
    "createdBy": "user-xyz",
    "createdAt": "2025-11-22T03:42:01.694Z",
    "shares": [
      { "userId": "user-xyz", "amount": 40, "status": "due" },
      { "userId": "user-123", "amount": 40, "status": "paid" }
    ]
  }
]


Frontend usage:
- “Who owes ME?” = Bills where createdBy = currentUserId AND share.status != paid AND share.userId != currentUserId
- “Who do I owe?” = Bills where share.userId = currentUserId AND share.status != paid



6. POST /groups/{groupId}/bills
URL:
 POST https://lfesbjfali.execute-api.us-west-1.amazonaws.com/groups/grp-123/bills


Headers:


Content-Type: application/json


Body:


{
  "description": "Internet",
  "amount": 80,
  "dueDate": "2025-11-15",
  "shares": [
    { "userId": "dummy-user", "amount": 40, "status": "due" },
    { "userId": "friend-1",   "amount": 40, "status": "due" }
  ]
}



Response:


{
  "groupId": "grp-123",
  "billId": "bill-<random-uuid>",
  "description": "Internet",
  "amount": 80,
  "dueDate": "2025-11-15",
  "createdBy": "dummy-user",
  "shares": [
    { "userId": "dummy-user", "amount": 40, "status": "due" },
    { "userId": "friend-1",   "amount": 40, "status": "due" }
  ]
}



Frontend should build shares array (who owes how much and their status) and send it to backend. 

7. GET /groups/{groupId}/bills/{billId}
Example:
 GET https://lfesbjfali.execute-api.us-west-1.amazonaws.com/groups/grp-123/bills/bill-1


Response:


{
  "billId": "bill-1",
  "groupId": "grp-123",
  "description": "Bill #1",
  "shares": [
    { "userId": "dummy-user", "amount": 25 },
    { "userId": "friend-1", "amount": 25 }
  ]
}

Bill detail page.

8. GET /me/summary
Example:
 GET https://lfesbjfali.execute-api.us-west-1.amazonaws.com/me/summary


Response:


{
  "userId": "dummy-user",
  "totalOwed": 80,
  "bills": [
    {
      "groupId": "grp-123",
      "billId": "bill-1",
      "description": "Internet",
      "amount": 80,
      "dueDate": "2025-11-28",
      "myAmount": 80,
      "status": "due"
    }
  ]
}



Use this for a “Dashboard / Summary” view.

9. PATCH /groups/{groupId}/bills/{billId}/shares/{userId}

Body:

 { "status": "paid" }

Behavior:


Loads the bill from DynamoDB.


Updates the matching shares[idx].status.


Saves the whole bill back.


Returns updated bill (with shares array).

10. POST /groups/{groupId}/join
Example:
 POST https://lfesbjfali.execute-api.us-west-1.amazonaws.com/groups/grp-123/join
Headers:
Content-Type: application/json

Body:
Frontend should ideally send FAT claims from Cognito:
{
  "userId": "<Cognito-sub>",
  "email": "<email-from-cognito>",
  "name": "<preferred_username-from-cognito>"
}

If frontend sends a `name` field, backend will store EXACTLY that name.
So frontend must ensure the correct display name is passed.


{
  "userId": "anthony-chu",
  "email": "anthony.chu777@gmail.com",
  "name": "Anthony Chu"
}

Response:
{
  "groupId": "grp-123",
  "name": "My Apartment",
  "createdBy": "dummy-user",
  "createdAt": "2025-11-20T21:52:13.653Z",
  "members": [
    { "userId": "dummy-user", "role": "owner" },
    {
      "userId": "anthony-chu",
      "email": "anthony.chu777@gmail.com",
      "name": "Anthony Chu",
      "role": "member",
      "joinedAt": "2025-11-21T01:02:34.000Z"
    }
  ]
}

Adds the user to members[] in the group’s DynamoDB item.


Subscribes their email to the SNS topic for bill reminders (they must confirm the email via AWS’s subscription email).

SNS.mjs:
This file is in another seperate lambda, and is fired from a scheduled Eventbridge. 
It has helpers to subscribe a user’s email to the SNS topic for reminders as well as publishes reminder messages to the SNS topic.


