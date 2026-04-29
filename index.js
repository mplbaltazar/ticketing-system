require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const session = require('express-session');
const PORT = process.env.PORT || 3000;
const ALLOWED_ROLES = ['admin', 'technician', 'customer'];
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'secretkey',
    resave: false,
    saveUninitialized: true
}));
app.set('view engine', 'ejs');
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

app.post('/register', async (req, res) => {
    const { full_name, contact, email, password, confirm_password } = req.body;
    if (!full_name || !contact || !email || !password || !confirm_password) {
        return res.send('All fields are required');
    }
    if (password !== confirm_password) {
        return res.send('Passwords do not match');
    }
    if (contact.length < 10) {
        return res.send('Invalid contact number');
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const role = 'customer';
        const sql = `
            INSERT INTO users (email, password, full_name, contact, role, created_at)
            VALUES (?, ?, ?, ?, ?, NOW())
        `;
        await db.query(sql, [email, hashedPassword, full_name, contact, role]);
        res.send('Registration successful!');
    } catch (err) {
        console.error(err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.send('Email already exists');
        }
        res.send('Something went wrong');
    }
});

app.post('/login', async (req, res) => {
    try {
        let { email, password } = req.body;
        if (!email || !password) {
            return res.send('Email and password are required');
        }
        email = email.trim().toLowerCase();
        password = password.trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.send('Invalid email format');
        }
        /*if (password.length < 6) {
            return res.send('Invalid credentials');
        }*/
        const sql = `
            SELECT user_id, email, password, full_name, role, contact, status
            FROM users 
            WHERE email = ?
        `;
        const [rows] = await db.query(sql, [email]);
        if (rows.length === 0) {
            return res.send('Invalid email or password');
        }
        const user = rows[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.send('Invalid email or password');
        }
        if (user.status === 'inactive') {
            return res.send('Account is inactive. Contact admin.');
        }
        req.session.user = {
            id: user.user_id,
            email: user.email,
            role: user.role,
            name: user.full_name,
            contact: user.contact
        };
        if (user.role === 'technician') {
            return res.redirect('/technician');
        } else if (user.role === 'admin') {
            return res.redirect('/admin');
        } else {
            return res.redirect('/dashboard');
        }
    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).send('Login error');
    }
});

app.get('/dashboard', checkActiveUser, async (req, res) => {
    try {
        const sessionUser = req.session.user;
        if (!sessionUser || !sessionUser.id) {
            return res.redirect('/');
        }
        const userId = sessionUser.id;
        if (isNaN(userId)) {
            return res.send("Invalid session user");
        }
        const sql = `
            SELECT * FROM tickets 
            WHERE created_by = ? 
            ORDER BY 
                CASE WHEN status = 'closed' THEN 1 ELSE 0 END, 
                CASE priority 
                    WHEN 'P1' THEN 1 
                    WHEN 'P2' THEN 2 
                    WHEN 'P3' THEN 3 
                    WHEN 'P4' THEN 4 
                    ELSE 5 
                END, 
                created_at DESC
        `;
        const [rows] = await db.query(sql, [userId]);
        const tickets = Array.isArray(rows) ? rows : [];
        res.render('dashboard', {
            user: sessionUser,
            tickets
        });
    } catch (err) {
        console.error("Dashboard Error:", err);
        res.status(500).send("Dashboard error");
    }
});

app.get('/technician', checkActiveUser, requireRole('technician'), async (req, res) => {
    try {
        const sessionUser = req.session.user;
        if (!sessionUser || !sessionUser.id) {
            return res.redirect('/');
        }
        const userId = sessionUser.id;
        if (isNaN(userId)) {
            return res.send("Invalid session user");
        }
        const sql = `
        SELECT 
            t.*, 
            u.full_name AS technician_name
        FROM tickets t
        LEFT JOIN users u ON t.assigned_to = u.user_id
        WHERE 
            t.status != 'closed'
            AND (
                t.assigned_to = ? 
                OR (t.priority = 'P1' AND t.assigned_to IS NULL)
            )
        ORDER BY t.created_at DESC
        `;
    
        const [rows] = await db.query(sql, [userId]);
        const tickets = Array.isArray(rows) ? rows : [];
        res.render('technician-dashboard', {
            user: sessionUser,
            tickets
        });
    } catch (err) {
        console.error("Technician Dashboard Error:", err);
        res.status(500).send("Technician page error");
    }
});

app.get('/admin', checkActiveUser, requireRole('admin'), async (req, res) => {
    try {
        const sessionUser = req.session.user;
        if (!sessionUser || !sessionUser.id) {
            return res.redirect('/');
        }
        if (isNaN(sessionUser.id)) {
            return res.send("Invalid session user");
        }
        const sql = `
            SELECT 
                t.*, 
                u.full_name AS created_by_name, 
                tech.full_name AS technician_name
            FROM tickets t
            LEFT JOIN users u ON t.created_by = u.user_id
            LEFT JOIN users tech ON t.assigned_to = tech.user_id
            ORDER BY 
                CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END,
                CASE t.priority 
                    WHEN 'P1' THEN 1 
                    WHEN 'P2' THEN 2 
                    WHEN 'P3' THEN 3 
                    WHEN 'P4' THEN 4 
                    ELSE 5 
                END,
                t.created_at DESC
        `;
        const [rows] = await db.query(sql);
        const tickets = Array.isArray(rows) ? rows : [];
        res.render('admin', {
            user: sessionUser,
            tickets
        });
    } catch (err) {
        console.error("Admin Dashboard Error:", err);
        res.status(500).send("Admin page error");
    }
});

app.get('/admin/users', checkActiveUser, requireRole('admin'), async (req, res) => {
    try {
        const sql = `
            SELECT user_id, full_name, email, role, contact, created_at, status 
            FROM users 
            ORDER BY created_at DESC
        `;
        const [rows] = await db.query(sql);
        res.render('admin-users', {
            user: req.session.user,
            users: rows
        });
    } catch (err) {
        console.error("Admin Users Error:", err);
        res.status(500).send("Something went wrong while loading users");
    }
});

app.post('/admin/users/update-role', checkActiveUser, requireRole('admin'), async (req, res) => {
    try {
        const { user_id, role } = req.body;
        if (!ALLOWED_ROLES.includes(role)) {
            return res.send('Invalid role');
        }
        if (parseInt(user_id) === req.session.user.id) {
            return res.send('You cannot change your own role');
        }
        const sql = 'UPDATE users SET role = ? WHERE user_id = ?';
        await db.query(sql, [
            role, 
            user_id]);
        res.redirect('/admin/users');
    } catch (err) {
        console.error("Update Role Error:", err);
        res.status(500).send("Error updating user role");
    }
});

app.get('/admin/users/new', checkActiveUser, requireRole('admin'), (req, res) => {
    res.render('admin-create-user', {
        user: req.session.user
    });
});

app.post('/admin/users/create', checkActiveUser, requireRole('admin'), async (req, res) => {
    try {
        const { full_name, email, password, role, contact } = req.body;
        if (!ALLOWED_ROLES.includes(role)) {
            return res.send('Invalid role');
        }
        const checkSql = 'SELECT user_id FROM users WHERE email = ?';
        const [existing] = await db.query(checkSql, [email]);
        if (existing.length > 0) {
            return res.send('Email already exists');
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const insertSql = `
            INSERT INTO users (full_name, email, password, role, contact)
            VALUES (?, ?, ?, ?, ?)
        `;
        await db.query(insertSql, [
            full_name,
            email,
            hashedPassword,
            role,
            contact || null]);
        res.redirect('/admin/users');

    } catch (err) {
        console.error("Create User Error:", err);
        res.status(500).send("Error creating new user");
    }
});

app.post('/admin/users/delete', checkActiveUser, requireRole('admin'), async (req, res) => {
    try {
        const { user_id } = req.body;
        if (!user_id || isNaN(user_id)) {
            return res.send('Invalid user ID');
        }
        if (parseInt(user_id) === req.session.user.id) {
            return res.send('You cannot deactivate your own account');
        }
        const sql = "UPDATE users SET status = 'inactive' WHERE user_id = ?";
        const [result] = await db.query(sql, [
            user_id
        ]);
        if (result.affectedRows === 0) {
            return res.send('User not found');
        }
        res.redirect('/admin/users');
    }catch (err){
        console.error("Deactive User Error:", err);
        res.status(500).send("Error deactivating user");
    }
});

app.post('/admin/users/toggle-status', checkActiveUser, requireRole('admin'), async (req, res) => {
    try{
        const { user_id, status } = req.body;
        if (!user_id || isNaN(user_id)) {
            return res.send('Invalid user ID');
        }
        if (parseInt(user_id) === req.session.user.id) {
            return res.send('You cannot change your own status');
        }
        const allowedStatus = ['active', 'inactive'];
        if (!allowedStatus.includes(status)) {
            return res.send('Invalid status');
        }
        const sql = 'UPDATE users SET status = ? WHERE user_id = ?';
        const [result] = await db.query(sql, [
            status, 
            user_id
        ]);
        if (result.affectedRows === 0) {
            return res.send('User not found');
        }
        res.redirect('/admin/users');
    }
    catch (err) {
        console.error("Deactive/activate User Error:", err);
        res.status(500).send("Error deactivating/activating user");
    }
});

app.get('/admin/users/edit/:id', checkActiveUser, requireRole('admin'), async (req, res) => {
    try{
        const user_id = req.params.id;
        const sql = `
            SELECT user_id, full_name, email, contact, role, status, position
            FROM users
            WHERE user_id = ?
        `;
        const [result] = await db.query(sql, [user_id]);
        if (result.length === 0) {
            return res.send('User not found');
        }
        res.render('admin-edit-user', {
            user: req.session.user,
            editUser: result[0]
        });
    }
    catch (err) {
        console.error("Opening user error:", err);
        res.status(500).send("Error opening user");
    }
});

app.post('/admin/users/update', checkActiveUser, requireRole('admin'), async (req, res) => {
    try {
        const { user_id, full_name, contact, role, status, position } = req.body;
        if (!user_id || isNaN(user_id)) {
            return res.send('Invalid user ID');
        }
        if (parseInt(user_id) === req.session.user.id) {
            return res.send('You cannot modify your own role or status');
        }
        if (!full_name || full_name.trim().length < 2) {
            return res.send('Invalid full name');
        }
        if (contact && !/^[0-9]+$/.test(contact)) {
            return res.send('Invalid contact number');
        }
        const allowedRoles = ['admin', 'technician', 'customer'];
        if (!allowedRoles.includes(role)) {
            return res.send('Invalid role');
        }
        const allowedStatus = ['active', 'inactive'];
        if (!allowedStatus.includes(status)) {
            return res.send('Invalid status');
        }
        if (position && position.length > 100) {
            return res.send('Position too long');
        }
        const sql = `
            UPDATE users
            SET full_name = ?, contact = ?, role = ?, status = ?, position = ?
            WHERE user_id = ?
        `;
        const [result] = await db.query(sql, [
            full_name.trim(),
            contact || null,
            role,
            status,
            position || null,
            user_id
        ]);
        if (result.affectedRows === 0) {
            return res.send('User not found');
        }
        res.redirect('/admin/users');
    } catch (err) {
        console.error("Updating user error:", err);
        res.status(500).send("Error updating user");
    }
});

app.get('/admin/technicians', async (req, res) => {
    try {
        const [rows] = await db.query(
            "SELECT user_id, full_name, email, position FROM users WHERE role = 'technician'"
        );

        res.render('technicians', { technicians: rows });

    } catch (err) {
        console.error(err);
        res.send("Error loading technicians");
    }
});

app.post('/forgot-password', async (req, res) => {
    try {
        let { email, new_password } = req.body;
        if (!email || !new_password) {
            return res.send('All fields are required');
        }
        email = email.trim();
        new_password = new_password.trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.send('Invalid email format');
        }
        if (new_password.length < 6) {
            return res.send('Password must be at least 6 characters long');
        }
        // if (!/[A-Z]/.test(new_password) || !/[0-9]/.test(new_password)) {
        //     return res.send('Password must include a number and uppercase letter');
        // }
        const hashedPassword = await bcrypt.hash(new_password, 10);
        const sql = 'UPDATE users SET password = ? WHERE email = ?';
        const [result] = await db.query(sql, [hashedPassword, email]);
        if (result.affectedRows === 0) {
            return res.send('Email not found');
        }
        res.send('Password updated successfully!');
    } catch (error) {
        console.error("Forgot Password Error:", error);
        res.status(500).send('Something went wrong');
    }
});

app.get('/tickets/create', checkActiveUser, async (req, res) => {
    try {
        const role = req.session.user.role;
        const userId = req.session.user.id;
        if (!role || !userId) {
            return res.redirect('/');
        }
        let technicians = [];
        if (role === 'technician' || role === 'admin') {
            const sql = `
                SELECT user_id, full_name 
                FROM users 
                WHERE role = 'technician' AND status = 'active'
            `;
            const [rows] = await db.query(sql);
            technicians = rows;
        }
        res.render('create-ticket', {
            role,
            technicians,
            currentUserId: role === 'technician' ? userId : null
        });

    } catch (err) {
        console.error("Load Create Ticket Page Error:", err);
        res.status(500).send("Error loading ticket form");
    }
});

app.post('/tickets/create', checkActiveUser, async (req, res) => {
    try {
        const { title, description, priority, assigned_to } = req.body;
        const userId = req.session.user.id;
        const role = req.session.user.role;
        if (!title || !description || !priority) {
            return res.send("All fields are required");
        }
        const cleanTitle = title.trim();
        const cleanDescription = description.trim();
        if (cleanTitle.length < 5 || cleanTitle.length > 255) {
            return res.send("Title must be between 5 and 255 characters");
        }
        if (cleanDescription.length < 10 || cleanDescription.length > 2000) {
            return res.send("Description must be between 10 and 2000 characters");
        }
        const allowedPriorities = ['P1', 'P2', 'P3', 'P4'];
        if (!allowedPriorities.includes(priority)) {
            return res.send("Invalid priority");
        }
        let assignedUser = null;
        if ((role === 'technician' || role === 'admin') && assigned_to) {
            if (isNaN(assigned_to)) {
                return res.send("Invalid technician ID");
            }
            const techSql = `
                SELECT user_id FROM users 
                WHERE user_id = ? AND role = 'technician' AND status = 'active'
            `;
            const [techRows] = await db.query(techSql, [assigned_to]);

            if (techRows.length === 0) {
                return res.send("Invalid or inactive technician");
            }
            assignedUser = assigned_to;
        }
        const ticketSql = `
            INSERT INTO tickets (title, description, priority, status, created_by, assigned_to)
            VALUES (?, ?, ?, 'open', ?, ?)
        `;
        const [result] = await db.query(ticketSql, [
            cleanTitle,
            cleanDescription,
            priority,
            userId,
            assignedUser
        ]);

        const ticketId = result.insertId;
        const commentSql = `
            INSERT INTO ticket_comments (ticket_id, user_id, comment)
            VALUES (?, ?, ?)
        `;
        await db.query(commentSql, [ticketId, userId, cleanDescription]);
        if (role === 'technician') {
            return res.redirect('/technician');
        } else if (role === 'admin') {
            return res.redirect('/admin');
        } else {
            return res.redirect('/dashboard');
        }

    } catch (err) {
        console.error("Create Ticket Error:", err);
        res.status(500).send("Error creating ticket");
    }
});

app.get('/tickets/view/:id', checkActiveUser, async (req, res) => {
    try {
        const ticketId = req.params.id;
        if (!ticketId || isNaN(ticketId)) {
            return res.send("Invalid ticket ID");
        }
        const ticketSql = `
            SELECT 
                t.*,
                c.full_name AS customer_name,
                c.contact AS customer_contact,
                tech.full_name AS technician_name,
                tech.contact AS technician_contact
            FROM tickets t
            JOIN users c ON t.created_by = c.user_id
            LEFT JOIN users tech ON t.assigned_to = tech.user_id
            WHERE t.ticket_id = ?
        `;
        const commentSql = `
            SELECT c.*, u.full_name, u.role
            FROM ticket_comments c
            JOIN users u ON c.user_id = u.user_id
            WHERE c.ticket_id = ?
            ORDER BY c.created_at ASC
        `;
        const techSql = `
            SELECT user_id, full_name FROM users WHERE role = 'technician'
        `;
        const [ticketRows] = await db.query(ticketSql, [ticketId]);
        if (ticketRows.length === 0) {
            return res.send("Ticket not found");
        }
        const [comments] = await db.query(commentSql, [ticketId]);
        const [technicians] = await db.query(techSql);
        const ticket = ticketRows[0];
        const userId = req.session.user.id;
        const role = req.session.user.role;
        const isOwner = ticket.created_by === userId;
        const isAssignedTech = ticket.assigned_to === userId;
        const isAdmin = role === 'admin';
        const isTechnician = role === 'technician';
        if (!isOwner && !isAssignedTech && !isAdmin && !isTechnician) {
            return res.send("Unauthorized access");
        }
        res.render('ticket-view', {
            ticket,
            comments,
            technicians,
            role,
            userId,
            backUrl: role === 'admin'
                ? '/admin'
                : role === 'technician'
                ? '/technician'
                : '/dashboard'
        });
    } catch (err) {
        console.error("View ticket error:", err);
        res.status(500).send("Error loading ticket");
    }
});

app.get('/tickets/my', checkActiveUser, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const role = req.session.user.role;
        if (!userId) {
            return res.redirect('/');
        }
        const sql = `
            SELECT * FROM tickets
            WHERE created_by = ? OR assigned_to = ?
            ORDER BY 
                CASE WHEN status = 'closed' THEN 1 ELSE 0 END,
                created_at DESC
        `;
        const [rows] = await db.query(sql, [userId, userId]);
        res.render('my-tickets', { 
            tickets: rows,
            dashtitle: 'My Tickets',
            backUrl: role === 'admin' 
                ? '/admin' 
                : role === 'technician' 
                ? '/technician' 
                : '/dashboard'
        });

    } catch (err) {
        console.error("My Tickets Error:", err);
        res.status(500).send("Error loading tickets");
    }
});

app.get('/tickets/all', checkActiveUser, async (req, res) => {
    try {
        const { role, id: userId } = req.session.user;
        const allowedRoles = ['admin', 'technician'];
        if (!allowedRoles.includes(role)) {
            return res.redirect('/dashboard');
        }
        if (!userId) {
            return res.redirect('/');
        }
        const sql = `
            SELECT t.*, u.full_name AS created_by_name
            FROM tickets t
            JOIN users u ON t.created_by = u.user_id
            ORDER BY 
                CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END,
                t.created_at DESC
        `;
        const [rows] = await db.query(sql);
        res.render('my-tickets', { 
            tickets: rows,
            dashtitle: 'All Tickets',
            backUrl: role === 'admin' ? '/admin' : '/technician'
        });

    } catch (err) {
        console.error("View All Tickets Error:", err);
        res.status(500).send("Error viewing all tickets");
    }
});

app.post('/tickets/assign', checkActiveUser, requireRole('technician', 'admin'), async (req, res) => {
    try {
        const { ticket_id, assigned_to } = req.body;
        const currentUserId = req.session.user.id;
        const assignedBy = req.session.user.name;
        const role = req.session.user.role;
        if (!ticket_id || isNaN(ticket_id)) {
            return res.send("Invalid ticket ID");
        }
        if (!assigned_to || isNaN(assigned_to)) {
            return res.send("Invalid technician ID");
        }
        const ticketSql = "SELECT * FROM tickets WHERE ticket_id = ?";
        const [ticketRows] = await db.query(ticketSql, [ticket_id]);
        if (ticketRows.length === 0) {
            return res.send("Ticket not found");
        }
        const ticket = ticketRows[0];
        if (ticket.assigned_to === parseInt(assigned_to)) {
            return res.send("Ticket is already assigned to this technician");
        }
        const isAssignedTech = ticket.assigned_to === currentUserId;
        const isUnassigned = !ticket.assigned_to;
        const isAdmin = role === 'admin';
        const isTechnician = role === 'technician';
        if (!isAdmin && !(isTechnician && (isAssignedTech || isUnassigned))) {
            return res.send("Unauthorized action");
        }
        const userSql = "SELECT full_name, role FROM users WHERE user_id = ?";
        const [userRows] = await db.query(userSql, [assigned_to]);
        if (userRows.length === 0 || userRows[0].role !== 'technician') {
            return res.send("Invalid technician selected");
        }
        const techName = userRows[0].full_name;
        const updateSql = `
            UPDATE tickets
            SET assigned_to = ?
            WHERE ticket_id = ?
        `;
        const [updateResult] = await db.query(updateSql, [assigned_to, ticket_id]);
        if (updateResult.affectedRows === 0) {
            return res.send("Assignment failed");
        }
        const message = `Ticket assigned to ${techName} by ${assignedBy} (${role})`;
        const commentSql = `
            INSERT INTO ticket_comments (ticket_id, user_id, comment)
            VALUES (?, ?, ?)
        `;
        await db.query(commentSql, [ticket_id, currentUserId, message]);
        res.redirect('/tickets/view/' + ticket_id);
    } catch (err) {
        console.error("Assign Ticket Error:", err);
        res.status(500).send("Error assigning ticket");
    }
});

app.post('/comments/add', checkActiveUser, async (req, res) => {
    try {
        const { comment, ticket_id } = req.body;
        const userId = req.session.user.id;
        const role = req.session.user.role;
        if (!ticket_id || isNaN(ticket_id)) {
            return res.send("Invalid ticket ID");
        }
        if (!comment || comment.trim() === '') {
            return res.send("Comment cannot be empty");
        }
        const cleanComment = comment.trim();
        if (cleanComment.length > 1000) {
            return res.send("Comment is too long");
        }
        const checkSql = `
            SELECT status, created_by, assigned_to
            FROM tickets
            WHERE ticket_id = ?
        `;
        const [rows] = await db.query(checkSql, [ticket_id]);
        if (rows.length === 0) {
            return res.send("Ticket not found");
        }
        const ticket = rows[0];
        if (ticket.status === 'closed') {
            return res.send("Cannot comment on closed ticket");
        }
        const isOwner = ticket.created_by === userId;
        const isAssignedTech = ticket.assigned_to === userId;
        const isAdmin = role === 'admin';
        if (!isOwner && !isAssignedTech && !isAdmin) {
            return res.send("Unauthorized");
        }
        const insertSql = `
            INSERT INTO ticket_comments (ticket_id, user_id, comment)
            VALUES (?, ?, ?)
        `;
        await db.query(insertSql, [ticket_id, userId, cleanComment]);
        res.redirect(`/tickets/view/${ticket_id}`);
    } catch (err) {
        console.error("Add Comment Error:", err);
        res.status(500).send("Error adding comment");
    }
});

app.post('/update-contact', checkActiveUser, async (req, res) => {
    try {
        const userId = req.session.user.id;
        let { contact, redirectTo } = req.body;
        if (!contact) {
            return res.send("Contact number is required");
        }
        contact = contact.trim();
        if (contact.length < 10 || contact.length > 20) {
            return res.send("Contact number must be between 10 and 20 digits");
        }
        if (!/^[0-9]+$/.test(contact)) {
            return res.send("Contact number must contain only numbers");
        }
        const allowedRedirects = ['/dashboard', '/admin', '/technician'];
        if (!allowedRedirects.includes(redirectTo)) {
            redirectTo = '/dashboard';
        }
        const sql = "UPDATE users SET contact = ? WHERE user_id = ?";
        const [result] = await db.query(sql, [contact, userId]);

        if (result.affectedRows === 0) {
            return res.send("User not found");
        }
        req.session.user.contact = contact;
        res.redirect(redirectTo);
    } catch (err) {
        console.error("Update Contact Error:", err);
        res.status(500).send("Error Updating Contact");
    }
});

app.post('/tickets/close', checkActiveUser, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const role = req.session.user.role;
        const userName = req.session.user.name;
        const { ticket_id } = req.body;
        if (!ticket_id || isNaN(ticket_id)) {
            return res.send("Invalid ticket ID");
        }
        const checkSql = `
            SELECT created_by, assigned_to, status
            FROM tickets
            WHERE ticket_id = ?
        `;
        const [rows] = await db.query(checkSql, [ticket_id]);
        if (rows.length === 0) {
            return res.send("Ticket not found");
        }
        const ticket = rows[0];
        if (ticket.status === 'closed') {
            return res.send("Ticket is already closed");
        }
        if (!ticket.assigned_to && role !== 'admin') {
            return res.send("Ticket must be assigned before closing");
        }
        const isOwner = ticket.created_by === userId;
        const isAssigned = ticket.assigned_to === userId;
        const isAdmin = role === 'admin';
        if (!isOwner && !isAssigned && !isAdmin) {
            return res.send("Unauthorized action");
        }
        const updateSql = "UPDATE tickets SET status = 'closed' WHERE ticket_id = ?";
        const [updateResult] = await db.query(updateSql, [ticket_id]);
        if (updateResult.affectedRows === 0) {
            return res.send("Failed to close ticket");
        }
        let closedBy;
        if (isAdmin) {
            closedBy = 'admin';
        } else if (isOwner) {
            closedBy = 'customer';
        } else {
            closedBy = 'technician';
        }
        const systemMessage = `This ticket was closed by ${userName} (${closedBy})`;
        const commentSql = `
            INSERT INTO ticket_comments (ticket_id, user_id, comment)
            VALUES (?, ?, ?)
        `;
        await db.query(commentSql, [ticket_id, userId, systemMessage]);
        res.redirect('/tickets/view/' + ticket_id);
    } catch (err) {
        console.error("Close Ticket Error:", err);
        res.status(500).send("Error closing ticket");
    }
});

app.post('/tickets/reopen', checkActiveUser, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const role = req.session.user.role;
        const userName = req.session.user.name;
        const { ticket_id, reopen_reason } = req.body;
        if (!ticket_id || isNaN(ticket_id)) {
            return res.send("Invalid ticket ID");
        }
        if (!reopen_reason || reopen_reason.trim() === '') {
            return res.send("Reopen reason is required");
        }
        const cleanReason = reopen_reason.trim();
        if (cleanReason.length > 1000) {
            return res.send("Reopen reason is too long");
        }
        const checkSql = `
            SELECT created_by, status
            FROM tickets
            WHERE ticket_id = ?
        `;
        const [rows] = await db.query(checkSql, [ticket_id]);
        if (rows.length === 0) {
            return res.send("Ticket not found");
        }
        const ticket = rows[0];
        const isOwner = ticket.created_by === userId;
        const isAdmin = role === 'admin';
        if (!isOwner && !isAdmin) {
            return res.send("Unauthorized action");
        }
        if (ticket.status !== 'closed') {
            return res.send("Ticket is not closed");
        }
        const updateSql = "UPDATE tickets SET status = 'open' WHERE ticket_id = ?";
        const [updateResult] = await db.query(updateSql, [ticket_id]);
        if (updateResult.affectedRows === 0) {
            return res.send("Failed to reopen ticket");
        }
        const reopenedBy = isAdmin ? 'admin' : 'customer';
        const message = `Ticket reopened by ${userName} (${reopenedBy}): ${cleanReason}`;
        const commentSql = `
            INSERT INTO ticket_comments (ticket_id, user_id, comment)
            VALUES (?, ?, ?)
        `;
        await db.query(commentSql, [ticket_id, userId, message]);
        res.redirect('/tickets/view/' + ticket_id);
    } catch (err) {
        console.error("Reopen Ticket Error:", err);
        res.status(500).send("Error reopening ticket");
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.send('Error logging out');
        }
        res.redirect('/');
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

async function checkActiveUser(req, res, next) {
    try {
        if (!req.session.user) {
            return res.redirect('/');
        }
        const userId = req.session.user.id;
        const [rows] = await db.query(
            "SELECT status FROM users WHERE user_id = ?",
            [userId]
        );
        if (rows.length === 0) {
            req.session.destroy();
            return res.redirect('/');
        }
        if (rows[0].status === 'inactive') {
            req.session.destroy();
            return res.send('Your account has been deactivated.');
        }
        next();
    } catch (err) {
        console.error(err);
        res.send("Session check error");
    }
}

function requireRole(...allowedRoles) {
    return (req, res, next) => {
        const userRole = req.session.user.role;
        if (!allowedRoles.includes(userRole)) {
            if (userRole === 'technician') return res.redirect('/technician');
            if (userRole === 'admin') return res.redirect('/admin');
            return res.redirect('/dashboard');
        }
        next();
    };
}