CREATE TABLE `book_lookups` (
	`isbn` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`authors` text NOT NULL,
	`cover_url` text,
	`source` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`isbn` text,
	`title` text NOT NULL,
	`authors` text NOT NULL,
	`cover_url` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `copies` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`owner_id` text,
	`holder_member_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_copies_book_id_books_id_fk` FOREIGN KEY (`book_id`) REFERENCES `books`(`id`),
	CONSTRAINT `fk_copies_owner_id_members_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `members`(`id`),
	CONSTRAINT `fk_copies_holder_member_id_members_id_fk` FOREIGN KEY (`holder_member_id`) REFERENCES `members`(`id`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`copy_id` text NOT NULL,
	`at` integer NOT NULL,
	`actor_id` text NOT NULL,
	`type` text NOT NULL,
	CONSTRAINT `fk_events_copy_id_copies_id_fk` FOREIGN KEY (`copy_id`) REFERENCES `copies`(`id`),
	CONSTRAINT `fk_events_actor_id_members_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `members`(`id`)
);
--> statement-breakpoint
CREATE TABLE `labels` (
	`code` text PRIMARY KEY NOT NULL,
	`minted_by` text NOT NULL,
	`minted_at` integer NOT NULL,
	`copy_id` text,
	`bound_at` integer,
	CONSTRAINT `fk_labels_minted_by_members_id_fk` FOREIGN KEY (`minted_by`) REFERENCES `members`(`id`),
	CONSTRAINT `fk_labels_copy_id_copies_id_fk` FOREIGN KEY (`copy_id`) REFERENCES `copies`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `books_isbn_unique` ON `books` (`isbn`);--> statement-breakpoint
CREATE INDEX `copies_owner_id_idx` ON `copies` (`owner_id`);--> statement-breakpoint
CREATE INDEX `copies_holder_member_id_idx` ON `copies` (`holder_member_id`);--> statement-breakpoint
CREATE INDEX `events_copy_id_id_idx` ON `events` (`copy_id`,`id`);--> statement-breakpoint
CREATE INDEX `labels_copy_id_idx` ON `labels` (`copy_id`);