CREATE TABLE `data_update_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`indicatorType` varchar(64) NOT NULL,
	`status` varchar(32) NOT NULL,
	`errorMessage` text,
	`recordsUpdated` int DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `data_update_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `indicator_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`indicatorType` varchar(64) NOT NULL,
	`observationDate` varchar(10) NOT NULL,
	`value` varchar(255) NOT NULL,
	`unit` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `indicator_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `liquidity_indicators` (
	`id` int AUTO_INCREMENT NOT NULL,
	`indicatorType` varchar(64) NOT NULL,
	`fredSeriesId` varchar(64),
	`observationDate` varchar(10) NOT NULL,
	`currentValue` varchar(255) NOT NULL,
	`previousValue` varchar(255),
	`changeValue` varchar(255),
	`changePercent` varchar(255),
	`unit` varchar(64) NOT NULL,
	`frequency` varchar(32) NOT NULL,
	`riskLevel` enum('normal','caution','warning') NOT NULL DEFAULT 'normal',
	`riskDescription` text,
	`dataSource` varchar(64) NOT NULL,
	`lastUpdatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `liquidity_indicators_id` PRIMARY KEY(`id`),
	CONSTRAINT `liquidity_indicators_indicatorType_unique` UNIQUE(`indicatorType`)
);
