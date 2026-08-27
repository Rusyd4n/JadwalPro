# Auth Testing Playbook (EduSchedule AI)

## Step 1: Create Test User & Session
```
mongosh --eval "
use('test_database');
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({
  user_id: userId,
  email: 'jauhar.jundi@gmail.com',
  name: 'Test Owner',
  picture: 'https://via.placeholder.com/150',
  created_at: new Date()
});
db.user_sessions.insertOne({
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
});
print('Session token: ' + sessionToken);
print('User ID: ' + userId);
"
```

## Step 2: Backend curl
```
curl -X GET "$BACKEND/api/auth/me" -H "Authorization: Bearer $TOKEN"
curl -X GET "$BACKEND/api/teachers" -H "Authorization: Bearer $TOKEN"
```

## Step 3: Browser
Set cookie `session_token` with domain=preview host, path=/, httpOnly, secure, sameSite=None; then navigate to `/dashboard`.
