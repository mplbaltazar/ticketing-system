Ticketing System
Setup Instructions
1. Clone the repo
git clone https://github.com/yourusername/your-repo.git
cd your-repo
2. Install dependencies
npm install
3. Setup Database
Open phpMyAdmin
Create a database (e.g. ticketing_system)
Import /database/backup.sql
4. Configure environment variables

Create a .env file:

DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=ticketing_system
5. Run the project
node app.js

Visit:
http://localhost:3000