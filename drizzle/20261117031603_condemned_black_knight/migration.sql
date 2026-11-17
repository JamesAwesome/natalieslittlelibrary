CREATE TABLE `identities` (
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`member_id` text NOT NULL,
	CONSTRAINT `identities_pk` PRIMARY KEY(`provider`, `subject`),
	CONSTRAINT `fk_identities_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`)
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`picture_url` text,
	`created_at` integer NOT NULL,
	`removed_at` integer
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY,
	`member_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT `fk_sessions_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`)
);
