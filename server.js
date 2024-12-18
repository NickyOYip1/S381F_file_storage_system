require('dotenv').config();
const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcrypt');
const fs = require('fs');
const cors = require('cors');

const app = express();

// Import models
const User = require('./models/user');
const File = require('./models/file');

// Create uploads directory if it doesn't exist
const uploadDir = './public/uploads';
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Middleware Setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    },
    name: 'sessionId'
}));

console.log('Session middleware configured');

// Configure multer for file upload
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Authentication Middleware with more logging
const isAuthenticated = (req, res, next) => {
    console.log('\n=== AUTH CHECK ===');
    
    if (!req.session || !req.session.user) {
        console.log('No user in session, redirecting to login');
        return res.redirect('/login');
    }
    
    // Add strict cache control headers
    res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma': 'no-cache',
        'Expires': '-1'
    });
    
    next();
};

// Update the isAdmin middleware to include more logging and better session checks
const isAdmin = (req, res, next) => {
    console.log('\n=== ADMIN AUTH CHECK ===');
    console.log('Session exists:', !!req.session);
    console.log('Session user:', req.session?.user);
    console.log('User role:', req.session?.user?.role);

    if (!req.session || !req.session.user) {
        console.log('No session or user found - redirecting to login');
        return res.redirect('/login');
    }

    if (req.session.user.role !== 'admin') {
        console.log('User is not admin - access denied');
        return res.status(403).render('error', { message: 'Access denied. Admin privileges required.' });
    }

    console.log('Admin access granted');
    console.log('=== ADMIN AUTH CHECK END ===\n');
    next();
};

// Routes
app.get('/', (req, res) => {
    console.log('Accessing root route');
    res.render('login', { error: null });
});

// Auth Routes
app.get('/login', (req, res) => {
    console.log('Accessing login route');
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log('Login attempt:', { email });
        
        const user = await User.findOne({ email });
        if (!user) {
            console.log('User not found');
            return res.render('login', { error: 'Invalid credentials' });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            console.log('Invalid password');
            return res.render('login', { error: 'Invalid credentials' });
        }

        // Set session
        req.session.user = {
            _id: user._id,
            email: user.email,
            role: user.role
        };
        
        console.log('Login successful');
        console.log('Session created:', req.session.user);
        
        // Use res.redirect instead of res.render
        if (user.role === 'admin') {
            return res.redirect('/admin/dashboard');
        } else {
            return res.redirect('/user/dashboard');
        }
    } catch (err) {
        console.error('Login error:', err);
        res.render('login', { error: 'Login failed' });
    }
});

// Logout route with extensive logging
app.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if(err) {
            console.error('Logout error:', err);
            return res.status(500).send('Logout failed');
        }
        
        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, private',
            'Pragma': 'no-cache',
            'Expires': '-1'
        });
        
        res.clearCookie('sessionId'); // Match the cookie name from session config
        res.redirect('/login');
    });
});

// Keep the GET route for direct URL access
app.get('/logout', (req, res) => {
    console.log('GET logout accessed - redirecting to POST');
    res.redirect('/login');
});

// Add a test route
app.get('/session-status', (req, res) => {
    console.log('\n=== SESSION STATUS ===');
    console.log('Session exists:', !!req.session);
    console.log('Session ID:', req.sessionID);
    console.log('Session data:', req.session);
    console.log('=== STATUS END ===\n');
    res.send('Session status logged - check console');
});

// Add this route to test session status
app.get('/session-check', (req, res) => {
    console.log('Current session:', req.session);
    res.send('Check console for session status');
});

// User Routes
app.get('/user/dashboard', isAuthenticated, async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.session.user._id);
        console.log('Looking for files with uploadedBy:', userId);

        const files = await File.find({ uploadedBy: userId })
            .sort({ uploadDate: -1 });

        console.log('Found files:', JSON.stringify(files, null, 2));

        res.render('user/dashboard', {
            user: req.session.user,
            files: files
        });
    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).send('Error loading dashboard');
    }
});

app.get('/user/create', isAuthenticated, (req, res) => {
    res.render('user/create', { file: {} });
});

app.get('/user/edit/:fileId', isAuthenticated, async (req, res) => {
    try {
        const file = await File.findById(req.params.fileId);
        if (!file) return res.status(404).send('File not found');
        res.render('user/edit', { file });
    } catch (err) {
        res.status(500).send('Error loading file');
    }
});

app.get('/user/delete/:fileId', isAuthenticated, async (req, res) => {
    try {
        const file = await File.findById(req.params.fileId);
        if (!file) return res.status(404).send('File not found');
        res.render('user/delete', { file });
    } catch (err) {
        res.status(500).send('Error loading file');
    }
});

// File Routes
app.post('/upload', isAuthenticated, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            console.log('No file uploaded');
            return res.redirect('/user/dashboard');
        }

        const userId = req.session.user._id;
        
        // Get next sequential ID for this user
        const nextSeqId = await File.getNextSequentialId(userId);
        
        // Create a combined fileId (userId_sequentialId)
        const fileId = `${userId}_${nextSeqId}`;

        const newFile = new File({
            fileId: fileId,
            sequentialId: nextSeqId,
            filename: req.file.originalname,
            originalName: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            data: req.file.buffer,
            uploadedBy: userId,
            uploadDate: new Date()
        });

        console.log('New file object:', {
            ...newFile.toObject(),
            data: 'Buffer data hidden for logging'
        });
        
        const savedFile = await newFile.save();
        console.log('File saved successfully');

        res.redirect('/user/dashboard');
    } catch (err) {
        console.error('Upload error:', err);
        console.error('Error details:', err.message);
        res.status(500).send('Error uploading file');
    }
});

app.get('/download/:fileId', isAuthenticated, async (req, res) => {
    try {
        const file = await File.findById(req.params.fileId);
        if (!file) {
            return res.status(404).send('File not found');
        }

        // Verify ownership
        if (file.uploadedBy.toString() !== req.session.user._id.toString()) {
            return res.status(403).send('Unauthorized');
        }

        // Set headers for file download
        res.set({
            'Content-Type': file.mimetype,
            'Content-Disposition': `attachment; filename="${file.originalName}"`,
            'Content-Length': file.size
        });

        // Send the file data
        res.send(file.data);

    } catch (err) {
        console.error('Download error:', err);
        res.status(500).send('Error downloading file');
    }
});

app.post('/files/:fileId/delete', isAuthenticated, async (req, res) => {
    try {
        const file = await File.findById(req.params.fileId);
        if (!file) {
            return res.status(404).send('File not found');
        }

        // Verify ownership
        if (file.uploadedBy.toString() !== req.session.user._id.toString()) {
            return res.status(403).send('Unauthorized');
        }

        // Delete file from database
        await File.findByIdAndDelete(req.params.fileId);
        
        res.redirect('/user/dashboard');
    } catch (err) {
        console.error('Delete error:', err);
        res.status(500).send('Error deleting file');
    }
});

// Admin Routes
app.get('/admin/dashboard', isAdmin, async (req, res) => {
    try {
        // Fetch statistics
        const stats = {
            users: await User.countDocuments(),
            files: await File.countDocuments()
        };

        // Render the admin dashboard
        res.render('admin/dashboard', {
            user: req.session.user,
            stats: stats
        });
    } catch (err) {
        console.error('Error in admin dashboard:', err);
        res.status(500).send('Server error');
    }
});

app.get('/admin/record', isAdmin, async (req, res) => {
    try {
        // Get all users
        const users = await User.find({}).sort({ userId: 1 });
        
        // Get file counts for each user
        const usersWithFiles = await Promise.all(users.map(async (user) => {
            const fileCount = await File.countDocuments({ 
                uploadedBy: user._id.toString() 
            });
            
            return {
                _id: user._id,
                userId: user.userId || 'N/A',
                email: user.email,
                role: user.role,
                fileCount: fileCount
            };
        }));

        res.render('admin/record', { 
            users: usersWithFiles,
            user: req.session.user
        });
    } catch (err) {
        console.error('Error fetching records:', err);
        res.status(500).send('Server error');
    }
});

app.get('/admin/createuser', isAdmin, (req, res) => {
    // Add cache control headers
    res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store'
    });
    
    res.render('admin/createuser', {
        user: req.session.user // Make sure to pass the user for header display
    });
});

app.post('/admin/createuser', isAdmin, async (req, res) => {
    try {
        const { email, password, role } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Get next sequential ID
        const lastUser = await User.findOne().sort({ userId: -1 });
        const nextUserId = lastUser ? (lastUser.userId + 1) : 1;

        await User.create({ 
            userId: nextUserId,
            email, 
            password: hashedPassword, 
            role 
        });
        
        res.redirect('/admin/record');
    } catch (err) {
        console.error('Error creating user:', err);
        res.status(500).send('Error creating user');
    }
});

app.post('/admin/users/:userId/delete', isAdmin, async (req, res) => {
    try {
        await User.findByIdAndDelete(req.params.userId);
        res.redirect('/admin/record');
    } catch (err) {
        res.status(500).send('Delete failed');
    }
});

// Show registration page
app.get('/register', (req, res) => {
    res.render('register', { error: null });
    console.log('Accessing register page');

});

// Handle registration
app.post('/register', async (req, res) => {
    try {
        const { email, password, confirmPassword, isAdmin } = req.body;
        
        console.log('Registration attempt:', {
            email,
            isAdmin: !!isAdmin
        });

        // Validate passwords match
        if (password !== confirmPassword) {
            return res.status(400).send('Passwords do not match');
        }

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).send('Email already registered');
        }

        // Get next sequential ID
        const lastUser = await User.findOne().sort({ userId: -1 });
        const nextUserId = lastUser ? (lastUser.userId + 1) : 1;
        console.log('Next User ID:', nextUserId);

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new user
        const newUser = new User({
            userId: nextUserId,
            email,
            password: hashedPassword,
            role: isAdmin ? 'admin' : 'user'
        });

        await newUser.save();
        console.log('User registered successfully:', {
            userId: newUser.userId,
            email: newUser.email,
            role: newUser.role
        });

        res.redirect('/login');
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).send('Error registering user');
    }
});
// Database connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/your_database')
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Add this to test view resolution
app.get('/test-view', (req, res) => {
    console.log('View path:', path.join(__dirname, 'views'));
    console.log('Available views:', require('fs').readdirSync(path.join(__dirname, 'views')));
    res.send('Check console for view debug info');
});

// Add a test route to verify session state
app.get('/test-session', (req, res) => {
    console.log('\n=== SESSION TEST ===');
    console.log('Current session:', req.session);
    console.log('Session ID:', req.sessionID);
    console.log('=== SESSION TEST END ===\n');
    res.send('Check console for session status');
});

app.post('/delete/:fileId', isAuthenticated, async (req, res) => {
    try {
        const file = await File.findById(req.params.fileId);
        
        if (!file || file.user.toString() !== req.session.user._id.toString()) {
            return res.status(404).send('File not found');
        }

        // Delete file from storage
        fs.unlink(file.path, async (err) => {
            if (err) {
                console.error('File deletion error:', err);
            }
            
            // Delete file from database
            await File.findByIdAndDelete(req.params.fileId);
            res.redirect('/user/dashboard');
        });
    } catch (err) {
        console.error('Delete error:', err);
        res.status(500).send('Error deleting file');
    }
});

// Add this route for testing
app.get('/test-files', isAuthenticated, async (req, res) => {
    try {
        // Find all files
        const allFiles = await File.find({});
        console.log('All files in database:', allFiles);
        
        // Find user's files
        const userFiles = await File.find({ user: req.session.user._id });
        console.log('User files:', userFiles);
        
        res.json({
            allFiles: allFiles,
            userFiles: userFiles
        });
    } catch (err) {
        console.error('Test query error:', err);
        res.status(500).send('Error testing files');
    }
});

// Debug route to check database contents
app.get('/debug-db', isAuthenticated, async (req, res) => {
    try {
        // Get all files
        const files = await File.find({});
        // Get all users
        const users = await User.find({});
        
        console.log('=== DATABASE DEBUG ===');
        console.log('Files:', JSON.stringify(files, null, 2));
        console.log('Users:', JSON.stringify(users, null, 2));
        console.log('Current user ID:', req.session.user._id);
        
        res.json({
            files: files,
            users: users,
            currentUser: req.session.user._id
        });
    } catch (err) {
        console.error('Debug error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/admin/check-session', (req, res) => {
    console.log('Checking admin session:', req.session);
    
    if (req.session && req.session.user && req.session.user.role === 'admin') {
        console.log('Admin session valid');
        return res.status(200).json({ valid: true });
    }
    
    console.log('Admin session invalid');
    return res.status(401).json({ valid: false });
});

// Add this temporary debug route
app.get('/debug-files', isAdmin, async (req, res) => {
    try {
        const allFiles = await File.find({});
        const allUsers = await User.find({});
        
        console.log('All files in system:', allFiles);
        console.log('All users in system:', allUsers);
        
        res.json({
            files: allFiles,
            users: allUsers
        });
    } catch (err) {
        console.error('Debug error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Add this route to handle file renaming
app.post('/files/rename', isAuthenticated, async (req, res) => {
    try {
        const { fileId, newFileName } = req.body;
        
        // Find the file and verify ownership
        const file = await File.findById(fileId);
        
        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Verify file ownership
        if (file.uploadedBy.toString() !== req.session.user._id.toString()) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        // Update the file name
        file.originalName = newFileName;
        await file.save();

        // Redirect back to dashboard
        res.redirect('/user/dashboard');
    } catch (err) {
        console.error('Rename error:', err);
        res.status(500).json({ error: 'Error renaming file' });
    }
});

// Temporary route to update existing users with IDs (remove after use)
app.get('/admin/update-user-ids', isAdmin, async (req, res) => {
    try {
        const users = await User.find({ userId: { $exists: false } }).sort({ _id: 1 });
        let nextId = 1;
        
        for (const user of users) {
            user.userId = nextId++;
            await user.save();
        }
        
        res.send('User IDs updated successfully');
    } catch (err) {
        console.error('Error updating user IDs:', err);
        res.status(500).send('Error updating user IDs');
    }
});

// Add these routes to your server.js

// 1. READ - GET API to read all files for a user by email
app.get('/api/files/:email', async (req, res) => {
    try {
        const decodedEmail = decodeURIComponent(req.params.email);
        console.log('Searching for files with email:', decodedEmail); // Debug log

        const user = await User.findOne({ email: decodedEmail });
        console.log('Found user:', user); // Debug log

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const files = await File.find({ uploadedBy: user._id })
            .select('sequentialId originalName uploadDate')
            .sort({ sequentialId: 1 });

        console.log('Found files:', files); // Debug log

        res.json({
            success: true,
            data: files.map(file => ({
                sequentialId: file.sequentialId,
                fileName: file.originalName,
                uploadDate: file.uploadDate
            }))
        });
    } catch (err) {
        console.error('API Read Error:', err);
        res.status(500).json({ 
            error: 'Error fetching files',
            details: err.message 
        });
    }
});

// 2. CREATE - POST API to create a new user
app.post('/api/users', async (req, res) => {
    try {
        const { email, password, role } = req.body;

        console.log('Creating user with email:', email); // Debug log

        // Validate required fields
        if (!email || !password) {
            return res.status(400).json({ 
                error: 'Email and password are required'
            });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Find the highest userId with explicit number handling
        const lastUser = await User.findOne({}, { userId: 1 }).sort({ userId: -1 });
        let nextUserId = 1; // Default to 1 if no users exist

        if (lastUser && typeof lastUser.userId === 'number') {
            nextUserId = lastUser.userId + 1;
        }

        console.log('Generated nextUserId:', nextUserId); // Debug log

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new user with explicit number type
        const newUser = new User({
            userId: parseInt(nextUserId, 10), // Ensure it's an integer
            email: email,
            password: hashedPassword,
            role: role || 'user'
        });

        console.log('Attempting to save user with userId:', newUser.userId); // Debug log

        const savedUser = await newUser.save();

        console.log('User saved successfully with userId:', savedUser.userId); // Debug log

        res.status(201).json({
            success: true,
            data: {
                userId: savedUser.userId,
                email: savedUser.email,
                role: savedUser.role
            }
        });
    } catch (err) {
        console.error('API Create Error:', err);
        res.status(500).json({ 
            error: 'Error creating user',
            details: err.message
        });
    }
});

// 3. UPDATE - PUT API to update file name
app.put('/api/files', async (req, res) => {
    try {
        const { email, fileId, newFileName } = req.body;

        // Find user
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Find and update file
        const file = await File.findOne({ 
            fileId: fileId,
            uploadedBy: user._id
        });

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        file.originalName = newFileName;
        await file.save();

        res.json({
            success: true,
            data: {
                fileId: file.fileId,
                newFileName: file.originalName
            }
        });
    } catch (err) {
        console.error('API Update Error:', err);
        res.status(500).json({ error: 'Error updating file' });
    }
});

// 4. DELETE - DELETE API to delete a file
app.delete('/api/files', async (req, res) => {
    try {
        const { email, fileId } = req.body;

        // Find user
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Find and delete file
        const file = await File.findOneAndDelete({ 
            fileId: fileId,
            uploadedBy: user._id
        });

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        res.json({
            success: true,
            message: 'File deleted successfully',
            data: {
                fileId: fileId,
                fileName: file.originalName
            }
        });
    } catch (err) {
        console.error('API Delete Error:', err);
        res.status(500).json({ error: 'Error deleting file' });
    }
});

// Temporary route to fix existing users without userId
app.get('/api/fix-users', async (req, res) => {
    try {
        // Find all users without userId
        const users = await User.find({ userId: { $exists: false } });
        console.log('Found users without userId:', users.length);

        // Update each user with a sequential userId
        for (let i = 0; i < users.length; i++) {
            await User.findByIdAndUpdate(users[i]._id, {
                $set: { userId: i + 1 }
            });
        }

        res.json({
            success: true,
            message: `Updated ${users.length} users with sequential IDs`
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add environment variables support
require('dotenv').config();

// Update MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/your_database');

// Update port for cloud deployment
const port = process.env.PORT || 3000;

// Update cors settings if needed
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));