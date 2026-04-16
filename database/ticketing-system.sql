-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Apr 16, 2026 at 01:15 PM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `ticketing-system`
--

-- --------------------------------------------------------

--
-- Table structure for table `tickets`
--

CREATE TABLE `tickets` (
  `ticket_id` int(11) NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text NOT NULL,
  `priority` enum('P1','P2','P3','P4','P5') DEFAULT 'P3',
  `status` enum('open','in_progress','resolved','closed') DEFAULT 'open',
  `created_by` int(11) NOT NULL,
  `assigned_to` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `tickets`
--

INSERT INTO `tickets` (`ticket_id`, `title`, `description`, `priority`, `status`, `created_by`, `assigned_to`, `created_at`, `updated_at`) VALUES
(1, 'Login Issue', 'Cannot login to system', 'P1', 'open', 5, NULL, '2026-04-10 14:21:19', '2026-04-10 14:26:47'),
(2, 'Page Error', 'Dashboard crashes', 'P2', 'in_progress', 5, 1, '2026-04-10 14:21:19', '2026-04-10 14:27:39'),
(3, 'Password Reset', 'Reset email not received', 'P3', 'resolved', 5, NULL, '2026-04-10 14:21:19', '2026-04-10 14:27:53'),
(4, 'UI Bug', 'Button not clickable', 'P4', 'open', 5, NULL, '2026-04-10 14:21:19', '2026-04-10 14:28:06'),
(5, 'Slow System', 'System is lagging', 'P5', 'closed', 5, NULL, '2026-04-10 14:21:19', '2026-04-10 14:28:15'),
(6, 'Mouse not working', 'My mouse is nuts', 'P1', 'open', 5, NULL, '2026-04-11 14:59:25', '2026-04-11 14:59:25'),
(7, 'A new ticket', 'TEsting this supreme ticket', 'P4', 'open', 3, NULL, '2026-04-11 15:03:02', '2026-04-11 15:03:02'),
(8, 'P1 Issue', 'Testing only', 'P5', 'open', 5, NULL, '2026-04-13 08:28:23', '2026-04-13 08:28:23'),
(9, 'Ticket with comment', 'This is a ticket with comment', 'P3', 'open', 5, NULL, '2026-04-13 15:15:36', '2026-04-13 15:15:36');

-- --------------------------------------------------------

--
-- Table structure for table `ticket_comments`
--

CREATE TABLE `ticket_comments` (
  `comment_id` int(11) NOT NULL,
  `ticket_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `comment` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `ticket_comments`
--

INSERT INTO `ticket_comments` (`comment_id`, `ticket_id`, `user_id`, `comment`, `created_at`) VALUES
(1, 1, 7, 'I am checking your issue now.', '2026-04-13 09:12:50'),
(2, 1, 6, 'Thank you, please update me.', '2026-04-13 09:12:50'),
(3, 1, 7, 'Issue identified. Working on fix.', '2026-04-13 09:12:50'),
(4, 2, 6, 'Can you provide more details?', '2026-04-13 09:12:50'),
(5, 2, 7, 'Yes, the error appears when logging in.', '2026-04-13 09:12:50'),
(6, 3, 7, 'This should be resolved now.', '2026-04-13 09:12:50'),
(7, 3, 2, 'Confirmed working. Thanks!', '2026-04-13 09:12:50'),
(8, 4, 3, 'Assigned to network team.', '2026-04-13 09:12:50'),
(9, 5, 7, 'Looking into this.', '2026-04-13 09:12:50'),
(10, 6, 2, 'Please restart your device and try again.', '2026-04-13 09:12:50'),
(11, 7, 6, 'We are escalating this issue.', '2026-04-13 09:12:50'),
(12, 8, 7, 'Fix deployed. Please verify.', '2026-04-13 09:12:50'),
(13, 9, 5, 'This is a ticket with comment', '2026-04-13 15:15:36'),
(14, 9, 5, 'Testing comment via customer update page', '2026-04-13 15:20:23');

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `user_id` int(11) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `full_name` varchar(255) NOT NULL,
  `contact` varchar(20) DEFAULT NULL,
  `role` enum('admin','technician','customer') NOT NULL,
  `position` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`user_id`, `email`, `password`, `full_name`, `contact`, `role`, `position`, `created_at`) VALUES
(1, 'admin@test.com', '$2b$10$.CXRF2aZoNa4WEbPBAVUoendxZXNx/ywoI5wT/T8YCZSgzSbirn8y', 'Admin User', NULL, 'admin', NULL, '2026-04-09 14:46:46'),
(2, 'tech@test.com', '$2b$10$E0NvZ9mvqXhD0ukDTqV08uQ9WHNQ3QYLVNWJjYSVirQs5mYeIdrza', 'Technician User', NULL, 'technician', NULL, '2026-04-09 14:46:46'),
(3, 'Test@test.com', '$2b$10$30sn8woFlXl3yw1v0DJeEOi25BYhrHFkfJc3PLy.GDeQFM.K7Fd4e', 'Test', NULL, 'customer', NULL, '2026-04-09 14:54:46'),
(5, 'thetest@test.com', '$2b$10$lMmmjTrM5j/yiQwLj4YlC.kkVfdfMWbSuB6BdZ.CgCK.4UZ5u1O2u', 'Testing purpose', NULL, 'customer', NULL, '2026-04-10 14:10:37'),
(6, 'tech1@email.com', '$2b$10$kElkoIIdoBfbir8ELvSg/Oku7rPAadHPFY/GZn7y4KSdv8Gp4u.zG', 'Juan Dela Cruz', NULL, 'technician', 'IT Support', '2026-04-13 09:08:43'),
(7, 'tech2@email.com', '$2b$10$Tp558LOORyzx/SC27itky.Ufkn1ew0sIoITnHld1Jiw7nNVfh2v2e', 'Maria Santos', NULL, 'technician', 'Network Engineer', '2026-04-13 09:08:43'),
(8, 'testnum@test.com', '$2b$10$6meEJhNHax8uNjohblLVcuMmOzdwqLeC8B/EUnAv2Wz3ug.vH8cJ.', 'Testing with number', '0978947456', 'customer', NULL, '2026-04-15 08:00:30');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `tickets`
--
ALTER TABLE `tickets`
  ADD PRIMARY KEY (`ticket_id`),
  ADD KEY `created_by` (`created_by`),
  ADD KEY `assigned_to` (`assigned_to`);

--
-- Indexes for table `ticket_comments`
--
ALTER TABLE `ticket_comments`
  ADD PRIMARY KEY (`comment_id`),
  ADD KEY `ticket_id` (`ticket_id`),
  ADD KEY `user_id` (`user_id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`user_id`),
  ADD UNIQUE KEY `email` (`email`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `tickets`
--
ALTER TABLE `tickets`
  MODIFY `ticket_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=10;

--
-- AUTO_INCREMENT for table `ticket_comments`
--
ALTER TABLE `ticket_comments`
  MODIFY `comment_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=15;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `user_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=9;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `tickets`
--
ALTER TABLE `tickets`
  ADD CONSTRAINT `tickets_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `tickets_ibfk_2` FOREIGN KEY (`assigned_to`) REFERENCES `users` (`user_id`) ON DELETE SET NULL;

--
-- Constraints for table `ticket_comments`
--
ALTER TABLE `ticket_comments`
  ADD CONSTRAINT `ticket_comments_ibfk_1` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`ticket_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `ticket_comments_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
