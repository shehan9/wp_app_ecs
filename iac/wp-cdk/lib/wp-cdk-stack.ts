import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
//import * as iam from 'aws-cdk-lib/aws-iam';

export class WpCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    //VPC 
    const vpc = new ec2.Vpc(this, "wp-app-vpc", {
      cidr: "10.1.0.0/16",

      subnetConfiguration: [
        {  cidrMask: 24, subnetType: ec2.SubnetType.PUBLIC, name: "Public" },
        ],
      maxAzs: 3 // Default is all AZs in region
      
    });

    //ECS cluster
    const cluster = new ecs.Cluster(this, "wp-app-ecs", {
      vpc: vpc
    });

    const taskDefinition = new ecs.Ec2TaskDefinition(this, 'wp-app-task-def');

    const container = taskDefinition.addContainer('wp-container', {
      image: ecs.ContainerImage.fromRegistry('wordpress:latest'),
      memoryLimitMiB: 256,
    });

    container.addPortMappings({
      containerPort: 80
    });
  

  }
}
